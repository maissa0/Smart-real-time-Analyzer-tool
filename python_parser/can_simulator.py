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
  --inject-duplicates     randomly resend the last frame unchanged
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


def _delivery_report(err, msg) -> None:
    """Kafka delivery callback — logs errors, used by Producer.produce()."""
    if err is not None:
        logging.error("Kafka delivery failed: %s", err)


def _produce_with_retry(producer: Producer, topic: str, *, key: bytes, value: bytes, on_delivery) -> None:
    """produce() raises BufferError when librdkafka's local queue is full. Poll to free space
    and retry once — a single transient full-queue condition would otherwise propagate up to
    the top-level exception handler and end the whole replay/session prematurely."""
    try:
        producer.produce(topic, key=key, value=value, on_delivery=on_delivery)
    except BufferError:
        logging.warning("Kafka local queue full for topic %s — polling and retrying once", topic)
        producer.poll(1)
        producer.produce(topic, key=key, value=value, on_delivery=on_delivery)


from log_parser import get_ascii_metadata, parse_log_stream
from models import DecodedFrame, DecodedSignal
from xml_decoder import _msg_id_key, encode_frame, load_catalog


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
        "--catalog-files",
        type=str,
        default=None,
        help="Comma-separated catalogue basenames to load (e.g. "
        "'powertrain_can.xml,chassis_can.xml'). Omit to load all — used to "
        "restrict simulated traffic to the catalogs assigned to a car.",
    )
    p.add_argument(
        "--kafka",
        type=str,
        default="127.0.0.1:9092",
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
        "--car-uid",
        type=str,
        default=None,
        help="Car UID to associate with the session (passed to session-meta)",
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
        "--inject-duplicates",
        action="store_true",
        help="Randomly resend the last frame unchanged, within the backend's duplicate window",
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

    # Must stay below IntegrityAnalyzerService.MIN_INTERVAL_SECONDS (1ms) so the
    # backend's DUPLICATE check (same msgId + identical payload within the window)
    # actually fires for injected duplicates.
    DUPLICATE_GAP_SECONDS = 0.0002

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
        # (msg_id, signal_name) -> (max_representable, valid_values) for signals
        # with a real catalog <values> enum. SIGNAL_RANGE injection targets these
        # so IntegrityAnalyzerService (which only validates signals with a
        # declared enum set) can actually detect the fault. max_representable is
        # the field capacity (mask >> shift) — injected values must fit in it or
        # bit-packing silently truncates them back into the valid range.
        self._injection_specs: dict[tuple[str, str], tuple[int, set[int]]] = {}
        self.fault_stats = {
            "value_errors": 0,
            "timing_gaps": 0,
            "counter_errors": 0,
            "duplicates": 0,
        }
        # Non-blocking timing gap: stores the wall-clock time until which
        # the simulator should suppress frame output. Set in trigger_timing_gap().
        # Main loop checks this instead of blocking with time.sleep(16-20).
        self.gap_active_until: float = 0.0
        # Replay-mode timing gap: frames whose LOG timestamps fall before this
        # value are dropped, creating a genuine timestamp gap the backend can
        # detect. (A wall-clock sleep never worked here — the log timestamps
        # stayed contiguous, so no TIMING_GAP fault was ever raised.)
        self.replay_gap_until: float = float("-inf")
        # Sorted --catalog-files list, stamped on every raw frame so the decoder
        # (and any downstream consumer) can decode with the same session scope.
        self._catalog_files_list: list[str] = sorted(self._catalog_file_filter() or [])

    def _catalog_file_filter(self) -> set[str] | None:
        """Basenames from --catalog-files, or None to load every catalogue."""
        raw = getattr(self.args, "catalog_files", None)
        if not raw:
            return None
        files = {f.strip() for f in raw.split(",") if f.strip()}
        return files or None

    def _load_catalog(self):
        """Load the (optionally per-car filtered) catalog and log the selection."""
        only = self._catalog_file_filter()
        catalog = load_catalog(Path(self.args.catalogues), only_files=only)
        if only:
            logging.info("Catalog restricted to files: %s (%d messages)",
                         sorted(only), len(catalog))
        if not catalog:
            logging.error("No catalog messages loaded (dir=%s, files=%s)",
                          self.args.catalogues, sorted(only) if only else "ALL")
        return catalog

    def _load_messages_from_catalog(self, catalog=None) -> list[dict]:
        """Build simulator message dicts from XML catalog (same shape as former MESSAGES)."""
        if catalog is None:
            catalog = self._load_catalog()
        self._injection_specs = self._build_injection_specs(catalog)
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
                    "cycle_ms": msg_def.cycle_ms,
                    "signals": signals_out,
                }
            )
        return messages

    @staticmethod
    def _build_injection_specs(catalog) -> dict[tuple[str, str], tuple[int, set[int]]]:
        """(msg_id, signal_name) -> (max_representable, valid_values) for every
        signal with a real XML <values> enum — the only signals
        IntegrityAnalyzerService's SIGNAL_RANGE check can validate.
        max_representable = mask >> shift, the largest value the bit field can
        carry; an injected value beyond it would be truncated by encode_frame."""
        specs: dict[tuple[str, str], tuple[int, set[int]]] = {}
        for msg_def in catalog.values():
            for sig in msg_def.signals:
                if not sig.value_map or sig.mask == 0:
                    continue
                valid: set[int] = set()
                for k in sig.value_map.keys():
                    try:
                        valid.add(int(str(k).strip()))
                    except ValueError:
                        continue
                if not valid:
                    continue
                max_representable = sig.mask >> sig.shift
                specs[(msg_def.msg_id, sig.signal_name)] = (max_representable, valid)
        return specs

    def _build_cycle_times(self, messages: list[dict]) -> dict[str, float]:
        """Per-message period (seconds) — prefers the catalog's own <Cyclic><cycle>
        value so simulated traffic matches the cadence the backend's integrity
        analyzer expects; falls back to the coarse per-bus default for messages
        with no catalog cycle time defined."""
        result: dict[str, float] = {}
        for msg in messages:
            cycle_ms = msg.get("cycle_ms")
            if cycle_ms:
                result[msg["msg_id"]] = cycle_ms / 1000.0
            else:
                result[msg["msg_id"]] = self.BUS_CYCLE_TIMES.get(msg["channel_name"], 2.0)
        return result

    def should_inject_fault(self) -> bool:
        return random.random() < self.args.fault_rate

    def inject_value_error(
        self, msg_id: str, signals: list[DecodedSignal]
    ) -> tuple[list[DecodedSignal], int | None]:
        """Corrupt one enum signal with a value that is INVALID per the catalog but
        still REPRESENTABLE in the signal's bit field. The old fixed raw_value=99
        was silently truncated by encode_frame for narrow fields (99 & 0x0F == 3,
        often a valid value) and the fault became undetectable after decode.

        Returns (signals, corrupted_index) — index is None when no signal in this
        frame has an injectable out-of-range value (fully-saturated enums).
        """
        if not signals:
            return signals, None
        corrupted = list(signals)
        candidates: list[tuple[int, list[int]]] = []
        for i, s in enumerate(corrupted):
            spec = self._injection_specs.get((msg_id, s.signal_name))
            if spec is None:
                continue
            max_representable, valid = spec
            invalid_values = [v for v in range(max_representable + 1) if v not in valid]
            if invalid_values:
                candidates.append((i, invalid_values))
        if not candidates:
            logging.warning(
                "[FAULT] No injectable enum signal in %s (all fields saturated) — "
                "value error skipped", msg_id)
            return signals, None
        idx, invalid_values = random.choice(candidates)
        s = corrupted[idx]
        corrupted[idx] = DecodedSignal(
            signal_name=s.signal_name,
            raw_value=random.choice(invalid_values),
            label="INJECTED_ERROR",
        )
        self.fault_stats["value_errors"] += 1
        logging.warning("[FAULT] Value error injected in signal: %s (value=%s)",
                        s.signal_name, corrupted[idx].raw_value)
        return corrupted, idx

    def _patch_signal_into_bytes(
        self, msg_id: str, raw_bytes: list[int], sig: DecodedSignal
    ) -> list[int]:
        """Overwrite ONLY the given signal's bits inside a copy of the original
        payload. Keeps every uncatalogued bit of a replayed frame intact — a full
        re-encode from catalogued signals used to zero those bits on corrupted
        frames. Falls back to full re-encode when the signal isn't in the catalog."""
        catalog = self._encode_catalog
        msg_def = catalog.get(_msg_id_key(msg_id)) if catalog else None
        if msg_def is not None:
            for sig_def in msg_def.signals:
                if sig_def.signal_name == sig.signal_name and sig_def.byte_num < 8:
                    patched = list(raw_bytes) + [0] * (max(0, sig_def.byte_num + 1 - len(raw_bytes)))
                    patched[sig_def.byte_num] = (
                        (patched[sig_def.byte_num] & ~sig_def.mask & 0xFF)
                        | ((int(sig.raw_value) << sig_def.shift) & sig_def.mask)
                    )
                    return patched
        # Signal not found in the encode catalog (should not happen — injection
        # only targets catalogued signals): leave the payload untouched rather
        # than re-encoding a partial signal list that would zero the rest.
        logging.warning("[FAULT] Could not patch %s into %s payload — bytes left unchanged",
                        sig.signal_name, msg_id)
        return list(raw_bytes)

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
        logging.info("[FAULT] Timing gap triggered: %.1fs suppression window started", gap)

    def inject_duplicate_frame(self, raw_payload: dict) -> None:
        """Re-publishes the just-sent frame unchanged except for a timestamp bumped by
        DUPLICATE_GAP_SECONDS (< the backend's 1ms window) — byte-identical raw_bytes
        and frame_seq, so IntegrityAnalyzerService's DUPLICATE check (same msgId +
        identical payload within the window) has real traffic to detect."""
        dup_payload = dict(raw_payload)
        dup_payload["timestamp"] = raw_payload["timestamp"] + self.DUPLICATE_GAP_SECONDS
        _produce_with_retry(
            self._producer,
            "raw-can-frames",
            key=self.session_id.encode("utf-8"),
            value=json.dumps(dup_payload).encode("utf-8"),
            on_delivery=_delivery_report,
        )
        self._producer.poll(0)
        self.fault_stats["duplicates"] += 1
        logging.info("[FAULT] Duplicate frame injected for %s", raw_payload["msg_id"])

    def inject_counter_error(self, msg_id: str):
        """Skip ahead in this message's real sequence counter (msg_seq), which is
        sent as frame_seq on every frame — creates a genuine gap the backend's
        integrity analyzer can detect. (Previously bumped the unrelated debug-only
        frame_counter, which has no effect on transmitted data.)"""
        skip = random.randint(2, 5)
        self.msg_seq[msg_id] = self.msg_seq.get(msg_id, -1) + skip
        self.fault_stats["counter_errors"] += 1
        logging.info("[FAULT] Counter error: skipped %d frame numbers for %s", skip, msg_id)

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
        status: str | None = None,
    ) -> None:
        meta = {
            "session_id": self.session_id,
            "source_filename": source_filename,
            "start_ts": start_ts,
            "end_ts": end_ts,
            "frame_count": frame_count,
        }
        if status is not None:
            meta["status"] = status
        # Link session to a vehicle if --car-uid was provided
        if getattr(self.args, 'car_uid', None):
            meta["car_uid"] = self.args.car_uid
        _produce_with_retry(
            self._producer,
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
            self.inject_counter_error(frame.msg_id)

        signals = list(frame.signals)
        corrupted_idx: int | None = None
        if self.args.inject_value_errors and self.should_inject_fault():
            signals, corrupted_idx = self.inject_value_error(frame.msg_id, signals)

        # Raw-byte selection:
        # 1. corrupted frame  -> patch ONLY the corrupted signal's bits into the
        #    original payload, preserving every uncatalogued bit
        # 2. source bytes set -> preserve them (replay: the log's real payload;
        #    random: already encoded by publish_random_frame). The old fallback
        #    to make_raw_bytes() replaced the log's payload with a one-signal-
        #    per-byte layout the decoder then mis-decoded against catalog masks.
        # 3. otherwise encode from signals, or last-resort naive packing
        if corrupted_idx is not None and frame.raw_bytes:
            raw_bytes = self._patch_signal_into_bytes(
                frame.msg_id, frame.raw_bytes, signals[corrupted_idx])
        elif corrupted_idx is not None and self._encode_catalog is not None:
            raw_bytes = self._encode_raw_bytes(frame.msg_id, signals, self._encode_catalog)
        elif frame.raw_bytes:
            raw_bytes = frame.raw_bytes
        elif self._encode_catalog is not None:
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
        if self._catalog_files_list:
            raw_payload["catalog_files"] = self._catalog_files_list
        _produce_with_retry(
            self._producer,
            "raw-can-frames",
            key=self.session_id.encode("utf-8"),
            value=json.dumps(raw_payload).encode("utf-8"),
            on_delivery=_delivery_report,
        )
        self._producer.poll(0)

        if self.args.inject_duplicates and self.should_inject_fault():
            self.inject_duplicate_frame(raw_payload)

        logging.debug(
            "[%d] %s @ %.3fs signals=%s",
            self.frame_counter,
            frame.msg_name,
            frame.timestamp,
            [f"{s.signal_name}:{s.raw_value}" for s in signals[:2]],
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
            logging.error("--log is required for replay mode")
            sys.exit(1)

        log_path = Path(self.args.log)
        logging.info("=== CAN Simulator — REPLAY MODE ===")
        logging.info("Log file : %s", self.args.log)
        logging.info("Speed    : %sx", self.args.speed)
        logging.info("Session  : %s", self.session_id)
        logging.info("Loop     : %s", self.args.loop)

        catalog = self._load_catalog()
        # Needed for re-encoding frames whose signals were corrupted by
        # value-error injection (untouched frames keep their log payload).
        self._encode_catalog = catalog
        self._injection_specs = self._build_injection_specs(catalog)

        # Pre-initialise so the KeyboardInterrupt handler always has valid timestamps,
        # even if the interrupt fires before get_ascii_metadata() returns.
        start_ts = 0.0
        end_ts = 0.0
        try:
            while True:
                self.frame_counter = 0

                # Extract session timestamps cheaply from head/tail lines — no full file load.
                # Spring Boot increments the exact frame count per frame via incrementFrameCount().
                metadata = get_ascii_metadata(log_path)
                start_ts = metadata.get("start_ts", 0.0)
                end_ts   = metadata.get("end_ts",   0.0)

                self._produce_session_meta(
                    os.path.basename(self.args.log),
                    start_ts,
                    end_ts,
                    0,  # Spring Boot increments exact count on each frame received
                )
                logging.info("Session published: %s", self.session_id)

                # Stream frames line-by-line — memory stays flat regardless of file size.
                # Invariant #2: parse_log_stream() must always be used; parse_log() is forbidden.
                prev_ts: float | None = None
                self.replay_gap_until = float("-inf")
                for frame in parse_log_stream(log_path, catalog, self.session_id):
                    # Timing-gap injection: DROP frames inside a window of LOG
                    # time. This creates a real timestamp gap the backend detects.
                    # (The old wall-clock sleep changed nothing in the timestamps,
                    # so no TIMING_GAP fault was ever raised, and it blocked the
                    # process for 16-20s per injection.)
                    if (self.args.inject_timing_gaps
                            and frame.timestamp >= self.replay_gap_until
                            and self.should_inject_fault()):
                        gap = random.uniform(16.0, 20.0)
                        self.replay_gap_until = frame.timestamp + gap
                        self.fault_stats["timing_gaps"] += 1
                        logging.info(
                            "[FAULT] Timing gap injected: dropping frames for "
                            "%.1fs of log time", gap)
                    if frame.timestamp < self.replay_gap_until:
                        # Fast-forward pacing through the gap so the process
                        # stays responsive; the timestamp gap remains in the data.
                        prev_ts = frame.timestamp
                        continue

                    if prev_ts is not None:
                        delta = (frame.timestamp - prev_ts) / self.args.speed
                        if delta > 0:
                            time.sleep(delta)
                    prev_ts = frame.timestamp

                    self._produce_frame(frame)

                self._producer.flush()

                if self.frame_counter == 0:
                    logging.error("No frames parsed from log file: %s", self.args.log)
                    sys.exit(1)

                logging.info(
                    "Replay complete. Frames: %d, Faults: %s",
                    self.frame_counter,
                    self.fault_stats,
                )

                # Natural end of a replay pass: mark the session COMPLETE.
                # Previously only the Ctrl+C/crash handlers sent a terminal
                # session-meta, so finished replays stayed open forever.
                self._produce_session_meta(
                    os.path.basename(self.args.log),
                    start_ts,
                    end_ts,
                    self.frame_counter,
                    status="COMPLETE",
                )
                logging.info("Session %s marked COMPLETE", self.session_id)

                if not self.args.loop:
                    break

                logging.info("Looping in 3 seconds...")
                self.session_id = str(uuid.uuid4())
                time.sleep(3)

        except KeyboardInterrupt:
            self._producer.flush()
            self._produce_session_meta(
                os.path.basename(self.args.log),
                start_ts,
                end_ts,
                self.frame_counter,
                status="COMPLETE",
            )
            logging.info(
                "Replay interrupted. Frames replayed: %d, Faults: %s",
                self.frame_counter,
                self.fault_stats,
            )
            logging.info("Session %s marked COMPLETE", self.session_id)
        except Exception:
            # Any other error (malformed log line, Kafka BufferError, catalog failure, ...) must
            # still flush the producer and send a terminal session-meta — otherwise the session
            # is stuck at frame_count=0 forever on the Java side (previously only handled for a
            # clean Ctrl+C). The exception is logged and re-raised so the failure stays visible
            # in the process exit code/logs rather than being silently treated as a normal stop.
            logging.exception("Replay crashed — flushing producer and marking session COMPLETE")
            self._producer.flush()
            self._produce_session_meta(
                os.path.basename(self.args.log),
                start_ts,
                end_ts,
                self.frame_counter,
                status="COMPLETE",
            )
            raise

    def run_random(self):
        logging.info("=== CAN Simulator — RANDOM MODE ===")
        logging.info("Session  : %s", self.session_id)
        logging.info("Speed    : %sx", self.args.speed)
        logging.info("Press Ctrl+C to stop")

        start_ts = time.time()
        self._session_start_ts = start_ts
        self._produce_session_meta("live_simulation", start_ts, start_ts + 3600, 0)
        logging.info("[SIM] session started: %s at %.3f", self.session_id, start_ts)
        logging.info("Session published: %s", self.session_id)

        catalog = self._load_catalog()
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
                        logging.debug(
                            "[SIM] frame #%d msg=%s signals=%d t=%.3f",
                            self.frame_counter,
                            msg["msg_id"],
                            len(signals),
                            now,
                        )

                if not sent_any:
                    time.sleep(0.05)

        except KeyboardInterrupt:
            self._producer.flush()
            logging.info(
                "Simulator stopped. Total frames: %d, Faults: %s",
                self.frame_counter,
                self.fault_stats,
            )
            end_ts = time.time()
            self._produce_session_meta(
                "live_simulation",
                self._session_start_ts,
                end_ts,
                self.frame_counter,
                status="COMPLETE",
            )
            logging.info("Session %s marked COMPLETE", self.session_id)
        except Exception:
            # See run_replay()'s matching handler: any non-KeyboardInterrupt error must still
            # flush + send a terminal session-meta so the session isn't stuck at frame_count=0.
            logging.exception("Simulator crashed — flushing producer and marking session COMPLETE")
            self._producer.flush()
            end_ts = time.time()
            self._produce_session_meta(
                "live_simulation",
                self._session_start_ts,
                end_ts,
                self.frame_counter,
                status="COMPLETE",
            )
            raise

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
