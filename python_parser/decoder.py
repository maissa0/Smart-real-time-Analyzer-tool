"""
decoder.py — CAN frame decoder service for KPIT Smart Real-Time CAN Analyser

Consumes raw CAN frames from the raw-can-frames Kafka topic,
decodes signals using the XML catalog, and produces decoded
results to the decoded-signals topic.

Usage:
    python decoder.py --catalogues catalogues --kafka localhost:9092
    python decoder.py --catalogues catalogues --kafka localhost:9092 --group decoder-group
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import time
from pathlib import Path

from confluent_kafka import Consumer, Producer, KafkaError

from xml_decoder import _msg_id_key, decode_frame, load_catalog

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [decoder] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ── Kafka helpers ──────────────────────────────────────────────────────────────


def make_consumer(bootstrap_servers: str, group_id: str) -> Consumer:
    """Create a Kafka consumer subscribed to raw-can-frames."""
    return Consumer(
        {
            "bootstrap.servers": bootstrap_servers,
            "group.id": group_id,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": True,
        }
    )


def make_producer(bootstrap_servers: str) -> Producer:
    """Create a Kafka producer with linger and lz4 compression."""
    return Producer(
        {
            "bootstrap.servers": bootstrap_servers,
            "linger.ms": 1,
            "compression.type": "lz4",
        }
    )


def delivery_report(err, msg) -> None:
    if err:
        log.error("Delivery failed for topic %s: %s", msg.topic(), err)


# ── Decoder service ────────────────────────────────────────────────────────────


class CanDecoderService:
    """Consumes raw CAN frames, decodes signals, produces to decoded-signals."""

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.running = False
        self.decoded_count = 0
        self.error_count = 0
        self.last_produce_time: float = 0.0
        # Option A: track arrival count per msg_id to detect Kafka delivery gaps
        self.last_seq: dict[str, int] = {}

        log.info("Loading catalog from: %s", args.catalogues)
        self.catalog = load_catalog(Path(args.catalogues))
        log.info("Catalog loaded — %d messages", len(self.catalog))

        log.info("Connecting to Kafka: %s", args.kafka)
        self.consumer = make_consumer(args.kafka, args.group)
        self.producer = make_producer(args.kafka)

    def _check_sequence(self, msg_id: str, frame_seq: int, session_id: str) -> None:
        """
        Compare incoming frame_seq to last seen seq for this msg_id.
        Detects gaps in Kafka delivery — logs GAP_DETECTED but always
        continues decoding and forwarding the frame.
        """
        if msg_id not in self.last_seq:
            self.last_seq[msg_id] = frame_seq
            return

        expected = self.last_seq[msg_id] + 1
        if frame_seq != expected:
            log.warning(
                "GAP_DETECTED — msg_id=%s session=%s expected_seq=%d "
                "got_seq=%d gap=%d",
                msg_id,
                session_id,
                expected,
                frame_seq,
                abs(frame_seq - expected),
            )
        self.last_seq[msg_id] = frame_seq

    def _decode_raw_frame(self, raw: dict) -> dict:
        """Decode signals from a raw frame dict and return decoded-signals payload."""
        msg_id = raw.get("msg_id", "")
        raw_bytes = raw.get("raw_bytes", [])
        session_id = raw.get("session_id", "")
        timestamp = raw.get("timestamp", time.time())

        # Decode signals using XML catalog
        decoded_signals = decode_frame(msg_id, raw_bytes, self.catalog)

        msg_id_key = _msg_id_key(msg_id)
        if msg_id_key in self.catalog:
            msg_def = self.catalog[msg_id_key]
            msg_name = msg_def.msg_name
            channel_name = msg_def.bus_name
        else:
            msg_name = "UNKNOWN"
            channel_name = "Unknown"
            log.warning(
                "Unknown ECU — frame ID %s not found in catalog (session: %s)",
                msg_id,
                raw.get("session_id", "unknown"),
            )

        # Build signals dict: { signal_name: { raw_value, label } }
        signals_dict = {
            sig.signal_name: {
                "raw_value": sig.raw_value,
                "label": sig.label,
            }
            for sig in decoded_signals
        }

        return {
            "session_id": session_id,
            "timestamp": timestamp,
            "channel": raw.get("channel", 1),
            "channel_name": channel_name,
            "msg_id": msg_id,
            "msg_name": msg_name,
            "raw_bytes": raw_bytes,
            "direction": raw.get("direction", "Rx"),
            "signals": signals_dict,
            # Flat signals for easy consumption: { Speed_High: 3, ... }
            "signals_flat": {
                sig.signal_name: sig.raw_value
                for sig in decoded_signals
            },
        }

    def _process_message(self, raw_json: str, session_key: str) -> None:
        """Parse, decode, and publish one raw CAN frame."""
        try:
            raw = json.loads(raw_json)

            # Inject session_id from Kafka key if missing in payload
            if not raw.get("session_id") and session_key:
                raw["session_id"] = session_key

            frame_seq = raw.get("frame_seq", -1)
            if frame_seq >= 0:
                self._check_sequence(
                    msg_id=raw.get("msg_id", "UNKNOWN"),
                    frame_seq=frame_seq,
                    session_id=raw.get("session_id", "unknown"),
                )

            decoded = self._decode_raw_frame(raw)

            session_id = decoded["session_id"] or session_key or "unknown"

            # Throttle output rate if configured
            if self.args.throttle > 0:
                now = time.time()
                elapsed = now - self.last_produce_time
                if elapsed < self.args.throttle:
                    time.sleep(self.args.throttle - elapsed)
                self.last_produce_time = time.time()

            self.producer.produce(
                "decoded-signals",
                key=session_id.encode("utf-8"),
                value=json.dumps(decoded).encode("utf-8"),
                on_delivery=delivery_report,
            )
            self.producer.poll(0)
            self.decoded_count += 1

            if self.decoded_count % 100 == 0:
                log.info(
                    "Decoded %d frames | Last: %s (%d signals)",
                    self.decoded_count,
                    decoded["msg_name"],
                    len(decoded["signals"]),
                )

        except json.JSONDecodeError as e:
            self.error_count += 1
            log.error("Invalid JSON in raw-can-frames: %s", e)
        except Exception as e:
            self.error_count += 1
            log.error("Failed to decode frame: %s", e)

    def run(self) -> None:
        """Main consume/decode/produce loop."""
        self.running = True

        signal.signal(signal.SIGINT, self._handle_stop)
        signal.signal(signal.SIGTERM, self._handle_stop)

        self.consumer.subscribe(["raw-can-frames"])
        log.info("Subscribed to raw-can-frames — waiting for messages...")

        print(f"\n=== CAN Decoder Service ===")
        print(f"Catalog  : {self.args.catalogues} ({len(self.catalog)} messages)")
        print(f"Kafka    : {self.args.kafka}")
        print(f"Group    : {self.args.group}")
        print(f"Input    : raw-can-frames")
        print(f"Output   : decoded-signals")
        print(f"Press Ctrl+C to stop\n")

        try:
            while self.running:
                msg = self.consumer.poll(timeout=1.0)

                if msg is None:
                    continue

                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    log.error("Consumer error: %s", msg.error())
                    continue

                session_key = msg.key().decode("utf-8") if msg.key() else ""
                raw_json = msg.value().decode("utf-8") if msg.value() else ""

                if raw_json:
                    self._process_message(raw_json, session_key)

        finally:
            self.consumer.close()
            self.producer.flush()
            log.info(
                "Decoder stopped — decoded: %d frames, errors: %d",
                self.decoded_count,
                self.error_count,
            )

    def _handle_stop(self, signum, frame) -> None:
        log.info("Stop signal received — shutting down...")
        self.running = False


# ── CLI ────────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="CAN decoder service — consumes raw-can-frames, produces decoded-signals"
    )
    parser.add_argument(
        "--catalogues",
        default="./catalogues",
        help="Path to XML catalog directory (default: ./catalogues)",
    )
    parser.add_argument(
        "--kafka",
        default="localhost:9092",
        help="Kafka bootstrap servers (default: localhost:9092)",
    )
    parser.add_argument(
        "--group",
        default="can-decoder",
        help="Kafka consumer group ID (default: can-decoder)",
    )
    parser.add_argument(
        "--throttle",
        type=float,
        default=0.0,
        help="Minimum seconds between producing messages (default: 0 = no throttle). "
        "Use 0.01 for ~100msg/sec, 0.005 for ~200msg/sec.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    service = CanDecoderService(args)
    service.run()
