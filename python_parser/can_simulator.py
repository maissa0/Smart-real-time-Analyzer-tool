#!/usr/bin/env python3
"""
CAN Bus Simulator
Modes:
  replay  — replay a log file at real speed with timing preserved
  random  — generate random CAN events continuously

Fault injection (optional flags):
  --inject-value-errors   randomly corrupt signal values
  --inject-timing-gaps    randomly pause transmission for a period
  --inject-counter-errors randomly skip frame sequence numbers
  --fault-rate FLOAT      probability of fault per frame (default 0.05)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
import uuid
from dataclasses import asdict
from pathlib import Path

from confluent_kafka import Producer

sys.path.insert(0, str(Path(__file__).parent))

from kafka_producer import _delivery_report
from log_parser import parse_log
from models import DecodedFrame, DecodedSignal
from xml_decoder import encode_frame, load_catalog


def build_argparser():
    p = argparse.ArgumentParser(description="CAN Bus Simulator")
    p.add_argument(
        "--mode",
        choices=["replay", "random"],
        default="replay",
        help="Simulator mode: replay a log file or generate random frames",
    )
    p.add_argument(
        "--log",
        type=str,
        default=None,
        help="Path to log file (required for replay mode)",
    )
    p.add_argument(
        "--catalogues",
        type=str,
        default=str(Path(__file__).parent / "catalogues"),
        help="Path to XML catalogues directory",
    )
    p.add_argument(
        "--kafka",
        type=str,
        default="localhost:9092",
        help="Kafka bootstrap server",
    )
    p.add_argument(
        "--speed",
        type=float,
        default=1.0,
        help="Playback speed multiplier (1.0 = real time, 2.0 = 2x faster)",
    )
    p.add_argument(
        "--session-id",
        type=str,
        default=None,
        help="Override session UUID",
    )
    p.add_argument(
        "--loop",
        action="store_true",
        help="Loop replay indefinitely (replay mode only)",
    )
    p.add_argument(
        "--inject-value-errors",
        action="store_true",
        help="Randomly inject out-of-range signal values",
    )
    p.add_argument(
        "--inject-timing-gaps",
        action="store_true",
        help="Randomly pause transmission to simulate timing gaps",
    )
    p.add_argument(
        "--inject-counter-errors",
        action="store_true",
        help="Randomly skip frames to simulate counter gaps",
    )
    p.add_argument(
        "--fault-rate",
        type=float,
        default=0.05,
        help="Probability of fault injection per frame (0.0-1.0)",
    )
    return p


class CanSimulator:
    """Publish CAN-like frames to Kafka (session-meta + decoded-frames), matching kafka_producer layout."""

    BUS_CYCLE_TIMES = {
        "Powertrain_CAN": 0.5,  # 500ms — 2fps, realistic for testing
        "Chassis_CAN": 0.5,  # 500ms — 2fps
        "Car_CAN": 2.0,  # 2s — unchanged
        "Key_CAN": 1.0,  # 1s — unchanged
    }

    def __init__(self, args):
        self.args = args
        self.session_id = args.session_id or str(uuid.uuid4())
        self._producer = Producer(
            {
                "bootstrap.servers": args.kafka,
                "linger.ms": 1,
                "compression.type": "lz4",
            }
        )
        self._encode_catalog = None
        self.frame_counter = 0
        self.msg_seq: dict[str, int] = {}  # per msg_id sequence counter
        self.fault_stats = {
            "value_errors": 0,
            "timing_gaps": 0,
            "counter_errors": 0,
        }
        # Non-blocking timing gap: stores the wall-clock time until which
        # the simulator should suppress frame output. Set in trigger_timing_gap().
        # Main loop checks this instead of blocking with time.sleep(16-20).
        self.gap_active_until: float = 0.0

    def _load_messages_from_catalog(self, catalog=None) -> list[dict]:
        """Build simulator message dicts from XML catalog (same shape as former MESSAGES)."""
        if catalog is None:
            catalog = load_catalog(Path(self.args.catalogues))
        messages: list[dict] = []
        for msg_def in catalog.values():
            signals_out: list[dict] = []
            for sig in msg_def.signals:
                if sig.value_map:
                    valid_values: list[int] = []
                    for k in sig.value_map.keys():
                        try:
                            valid_values.append(int(str(k).strip()))
                        except ValueError:
                            continue
                    if not valid_values:
                        valid_values = [0, 1]
                else:
                    valid_values = [0, 1]
                signals_out.append(
                    {
                        "signal_name": sig.signal_name,
                        "valid_values": valid_values,
                    }
                )
            messages.append(
                {
                    "msg_id": msg_def.msg_id,
                    "msg_name": msg_def.msg_name,
                    "channel": 1,
                    "channel_name": msg_def.bus_name,
                    "signals": signals_out,
                }
            )
        return messages

    def _build_cycle_times(self, messages: list[dict]) -> dict[str, float]:
        """Per-message period (seconds) from bus name."""
        return {
            msg["msg_id"]: self.BUS_CYCLE_TIMES.get(msg["channel_name"], 2.0)
            for msg in messages
        }

    def should_inject_fault(self) -> bool:
        return random.random() < self.args.fault_rate

    def inject_value_error(self, signals: list[DecodedSignal]) -> list[DecodedSignal]:
        if not signals:
            return signals
        corrupted = list(signals)
        idx = random.randint(0, len(corrupted) - 1)
        s = corrupted[idx]
        corrupted[idx] = DecodedSignal(
            signal_name=s.signal_name,
            raw_value=99,
            label="INJECTED_ERROR",
        )
        self.fault_stats["value_errors"] += 1
        print(f"  [FAULT] Value error injected in signal: {corrupted[idx].signal_name}")
        return corrupted

    def inject_timing_gap(self):
        """Legacy blocking version — kept for replay mode compatibility."""
        gap = random.uniform(16.0, 20.0)
        print(f"  [FAULT] Timing gap injected: sleeping {gap:.1f}s")
        self.fault_stats["timing_gaps"] += 1
        time.sleep(gap)

    def trigger_timing_gap(self) -> None:
        """Non-blocking timing gap for random mode.

        Sets gap_active_until to a future timestamp.
        The main loop skips frame output while time.time() < gap_active_until,
        yielding with time.sleep(0.001) instead of blocking for 16-20 seconds.
        This keeps the process responsive to signals (SIGTERM, Kafka flush, etc).
        """
        gap = random.uniform(16.0, 20.0)
        self.gap_active_until = time.time() + gap
        self.fault_stats["timing_gaps"] += 1
        print(f"  [FAULT] Timing gap triggered: {gap:.1f}s suppression window started")

    def inject_counter_error(self):
        skip = random.randint(2, 5)
        self.frame_counter += skip
        self.fault_stats["counter_errors"] += 1
        print(f"  [FAULT] Counter error: skipped {skip} frame numbers")

    def make_raw_bytes(self, signals: list[DecodedSignal]) -> list[int]:
        raw = [0] * 8
        for i, sig in enumerate(signals[:8]):
            raw[i] = int(sig.raw_value) & 0xFF
        return raw

    def _encode_raw_bytes(self, msg_id: str, signals: list, catalog) -> list[int]:
        """Encode signals into raw bytes using catalog bit masks."""
        return encode_frame(msg_id, signals, catalog)

    def _produce_session_meta(
        self,
        source_filename: str,
        start_ts: float,
        end_ts: float,
        frame_count: int,
    ) -> None:
        meta = {
            "session_id": self.session_id,
            "source_filename": source_filename,
            "start_ts": start_ts,
            "end_ts": end_ts,
            "frame_count": frame_count,
        }
        self._producer.produce(
            "session-meta",
            key=self.session_id.encode("utf-8"),
            value=json.dumps(meta).encode("utf-8"),
            on_delivery=_delivery_report,
        )
        self._producer.poll(0)
        self._producer.flush()

    def _produce_frame(self, frame: DecodedFrame) -> None:
        self.frame_counter += 1

        if self.args.inject_counter_errors and self.should_inject_fault():
            self.inject_counter_error()

        signals = list(frame.signals)
        if self.args.inject_value_errors and self.should_inject_fault():
            signals = self.inject_value_error(signals)

        if self._encode_catalog is not None:
            raw_bytes = self._encode_raw_bytes(frame.msg_id, signals, self._encode_catalog)
        else:
            raw_bytes = self.make_raw_bytes(signals)
        out = DecodedFrame(
            timestamp=frame.timestamp,
            channel=frame.channel,
            channel_name=frame.channel_name,
            msg_id=frame.msg_id,
            msg_name=frame.msg_name,
            raw_bytes=raw_bytes,
            signals=signals,
            direction=frame.direction,
        )

        msg_seq = self.msg_seq.get(out.msg_id, -1) + 1
        self.msg_seq[out.msg_id] = msg_seq

        raw_payload = {
            "session_id": self.session_id,
            "timestamp": out.timestamp,
            "channel": out.channel,
            "channel_name": out.channel_name,
            "msg_id": out.msg_id,
            "msg_name": out.msg_name,
            "raw_bytes": out.raw_bytes,
            "direction": out.direction,
            "frame_seq": msg_seq,
        }
        self._producer.produce(
            "raw-can-frames",
            key=self.session_id.encode("utf-8"),
            value=json.dumps(raw_payload).encode("utf-8"),
            on_delivery=_delivery_report,
        )
        self._producer.poll(0)

        preview = [f"{s.signal_name}:{s.raw_value}" for s in signals[:2]]
        print(
            f"  [{self.frame_counter}] {frame.msg_name} @ {frame.timestamp:.3f}s "
            f"signals={preview}"
        )

    def publish_random_frame(self, msg_def: dict, signals: list[DecodedSignal], timestamp: float):
        raw_bytes = self._encode_raw_bytes(
            msg_def["msg_id"], signals, self._encode_catalog
        )
        frame = DecodedFrame(
            timestamp=timestamp,
            channel=msg_def["channel"],
            channel_name=msg_def["channel_name"],
            msg_id=msg_def["msg_id"],
            msg_name=msg_def["msg_name"],
            raw_bytes=raw_bytes,
            signals=signals,
            direction="Rx",
        )
        self._produce_frame(frame)

    def run_replay(self):
        if not self.args.log:
            print("ERROR: --log is required for replay mode")
            sys.exit(1)

        print("\n=== CAN Simulator — REPLAY MODE ===")
        print(f"Log file : {self.args.log}")
        print(f"Speed    : {self.args.speed}x")
        print(f"Session  : {self.session_id}")
        print(f"Loop     : {self.args.loop}")
        print()

        catalog = load_catalog(Path(self.args.catalogues))

        while True:
            self.frame_counter = 0
            session = parse_log(Path(self.args.log), catalog, self.session_id)
            frames = session.frames
            if not frames:
                print("ERROR: No frames parsed from log file")
                sys.exit(1)

            print(f"Loaded {len(frames)} frames from log file")

            self._produce_session_meta(
                os.path.basename(self.args.log),
                session.start_ts,
                session.end_ts,
                len(frames),
            )
            print(f"Session published: {self.session_id}")

            prev_ts = frames[0].timestamp
            for frame in frames:
                if self.args.inject_timing_gaps and self.should_inject_fault():
                    self.inject_timing_gap()

                delta = (frame.timestamp - prev_ts) / self.args.speed
                if delta > 0:
                    time.sleep(delta)
                prev_ts = frame.timestamp

                self._produce_frame(frame)

            self._producer.flush()
            print(f"\nReplay complete. Frames: {len(frames)}, Faults: {self.fault_stats}")

            if not self.args.loop:
                break

            print("Looping in 3 seconds...\n")
            self.session_id = str(uuid.uuid4())
            time.sleep(3)

    def run_random(self):
        print("\n=== CAN Simulator — RANDOM MODE ===")
        print(f"Session  : {self.session_id}")
        print(f"Speed    : {self.args.speed}x")
        print("Press Ctrl+C to stop\n")

        start_ts = time.time()
        self._produce_session_meta("live_simulation", start_ts, start_ts + 3600, 0)
        print(f"Session published: {self.session_id}")

        catalog = load_catalog(Path(self.args.catalogues))
        self._encode_catalog = catalog
        messages = self._load_messages_from_catalog(catalog)
        cycle_times = self._build_cycle_times(messages)
        last_sent = {msg["msg_id"]: 0.0 for msg in messages}

        state: dict[str, int] = {}
        for msg in messages:
            for sig in msg["signals"]:
                state[sig["signal_name"]] = random.choice(sig["valid_values"])

        try:
            while True:
                now = time.time()

                # ── Non-blocking timing gap check ──────────────────────────
                # If a gap is active, yield the thread for 1ms and skip
                # this iteration entirely — no frames sent during the gap.
                if now < self.gap_active_until:
                    time.sleep(0.001)
                    continue

                sent_any = False
                for msg in messages:
                    cycle = cycle_times.get(msg["msg_id"], 2.0) / self.args.speed

                    # Trigger a new timing gap (non-blocking)
                    if self.args.inject_timing_gaps and self.should_inject_fault():
                        self.trigger_timing_gap()
                        continue

                    if now - last_sent[msg["msg_id"]] >= cycle:
                        if random.random() < 0.3:
                            sig = random.choice(msg["signals"])
                            state[sig["signal_name"]] = random.choice(sig["valid_values"])
                        signals = [
                            DecodedSignal(
                                signal_name=sig["signal_name"],
                                raw_value=state[sig["signal_name"]],
                                label=str(state[sig["signal_name"]]),
                            )
                            for sig in msg["signals"]
                        ]

                        self.publish_random_frame(msg, signals, now)
                        last_sent[msg["msg_id"]] = now
                        sent_any = True

                if not sent_any:
                    time.sleep(0.05)

        except KeyboardInterrupt:
            self._producer.flush()
            print(
                f"\nSimulator stopped. Total frames: {self.frame_counter}, "
                f"Faults: {self.fault_stats}"
            )

    def run(self):
        if self.args.mode == "replay":
            self.run_replay()
        else:
            self.run_random()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = build_argparser().parse_args()
    sim = CanSimulator(args)
    sim.run()


if __name__ == "__main__":
    main()
