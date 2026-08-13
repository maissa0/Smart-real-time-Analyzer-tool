"""
decoder.py — CAN frame decoder service for KPIT Smart Real-Time CAN Analyser

Consumes raw CAN frames from the raw-can-frames Kafka topic,
decodes signals using the XML catalog, and produces decoded
results to the decoded-signals topic.

Usage:
    python decoder.py --catalogues catalogues --kafka 127.0.0.1:9092
    python decoder.py --catalogues catalogues --kafka 127.0.0.1:9092 --group decoder-group
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

# How often (seconds) the run loop checks the catalog directory for changes.
CATALOG_RELOAD_CHECK_INTERVAL_S = 5.0


def catalog_fingerprint(catalogue_dir: Path) -> tuple:
    """Snapshot of the catalog directory: (name, mtime_ns, size) per XML file.

    Any edit, addition, or deletion of a catalog file changes the fingerprint,
    which the run loop uses to hot-reload definitions saved by the backend's
    catalog editor without restarting the decoder.
    """
    entries = []
    for path in sorted(Path(catalogue_dir).glob("*.xml")):
        try:
            stat = path.stat()
        except OSError:
            continue  # file vanished mid-scan — next check settles it
        entries.append((path.name, stat.st_mtime_ns, stat.st_size))
    return tuple(entries)


# ── Kafka helpers ──────────────────────────────────────────────────────────────


def make_consumer(bootstrap_servers: str, group_id: str) -> Consumer:
    """Create a Kafka consumer subscribed to raw-can-frames."""
    return Consumer(
        {
            "bootstrap.servers": bootstrap_servers,
            "group.id": group_id,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": False,
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


def produce_with_retry(producer: Producer, topic: str, *, key: bytes, value: bytes, on_delivery) -> None:
    """produce() raises BufferError when librdkafka's local queue is full. Poll to free space
    and retry once instead of letting a transient full-queue condition discard the message
    (same pattern as file_worker.py/can_simulator.py's produce_with_retry helpers)."""
    try:
        producer.produce(topic, key=key, value=value, on_delivery=on_delivery)
    except BufferError:
        log.warning("Kafka local queue full for topic %s — polling and retrying once", topic)
        producer.poll(1)
        producer.produce(topic, key=key, value=value, on_delivery=on_delivery)


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

        # Hot-reload state: fingerprint of the catalog dir, re-checked
        # periodically so edits saved via the backend editor take effect live.
        self._catalog_fingerprint = catalog_fingerprint(Path(args.catalogues))
        self._next_reload_check = time.monotonic() + CATALOG_RELOAD_CHECK_INTERVAL_S

        # Session-scoped catalogs: frames may carry a "catalog_files" list (set by
        # the simulator / file_worker from the car's assignment). Each unique set
        # gets its own filtered catalog so two catalog variants sharing message
        # IDs can never cross-decode. Cache keyed by the normalized filename set.
        self._scoped_catalogs: dict[frozenset, dict] = {}

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

    def _catalog_for(self, catalog_files) -> dict:
        """Catalog restricted to the frame's session scope; full catalog when unscoped."""
        if not isinstance(catalog_files, list):
            return self.catalog
        key = frozenset(str(f).strip().lower() for f in catalog_files if str(f).strip())
        if not key:
            return self.catalog
        cached = self._scoped_catalogs.get(key)
        if cached is None:
            if len(self._scoped_catalogs) >= 64:
                # Simple bound — scoped sets are few (one per distinct car config)
                self._scoped_catalogs.clear()
            cached = load_catalog(Path(self.args.catalogues), only_files=set(key))
            self._scoped_catalogs[key] = cached
            log.info("Loaded session-scoped catalog %s — %d messages",
                     sorted(key), len(cached))
        return cached

    def _maybe_reload_catalog(self) -> None:
        """Reload the catalog when any XML file changed on disk.

        Cheap stat()-based fingerprint check, throttled to every
        CATALOG_RELOAD_CHECK_INTERVAL_S seconds. On change, the merged catalog
        is rebuilt and the scoped-catalog cache dropped so every subsequent
        frame decodes against the fresh definitions.
        """
        now = time.monotonic()
        if now < self._next_reload_check:
            return
        self._next_reload_check = now + CATALOG_RELOAD_CHECK_INTERVAL_S
        current = catalog_fingerprint(Path(self.args.catalogues))
        if current == self._catalog_fingerprint:
            return
        log.info("Catalog change detected — reloading from %s", self.args.catalogues)
        try:
            self.catalog = load_catalog(Path(self.args.catalogues))
        except Exception as e:
            # Keep decoding with the previous catalog; retry on the next check.
            log.error("Catalog reload failed — keeping previous catalog: %s", e)
            return
        self._catalog_fingerprint = current
        self._scoped_catalogs.clear()
        log.info("Catalog reloaded — %d messages", len(self.catalog))

    def _decode_raw_frame(self, raw: dict) -> dict:
        """Decode signals from a raw frame dict and return decoded-signals payload."""
        msg_id = raw.get("msg_id", "")
        raw_bytes = raw.get("raw_bytes", [])
        session_id = raw.get("session_id", "")
        timestamp = raw.get("timestamp", time.time())

        # Decode signals using the session-scoped XML catalog (falls back to the
        # full merged catalog for frames without a catalog_files scope).
        catalog = self._catalog_for(raw.get("catalog_files"))
        decoded_signals = decode_frame(msg_id, raw_bytes, catalog)

        msg_id_key = _msg_id_key(msg_id)
        if msg_id_key in catalog:
            msg_def = catalog[msg_id_key]
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
            "frame_seq": raw.get("frame_seq", -1),
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

            # Throttle output rate if configured.
            # Use a micro-sleep loop (1 ms steps) so the producer delivery queue
            # is serviced during the wait and the consumer thread is never held
            # longer than 1 ms at a stretch — well within max.poll.interval.ms.
            if self.args.throttle > 0:
                now = time.time()
                elapsed = now - self.last_produce_time
                if elapsed < self.args.throttle:
                    wait_until = self.last_produce_time + self.args.throttle
                    while time.time() < wait_until:
                        self.producer.poll(0)   # service delivery callbacks during wait
                        time.sleep(0.001)       # 1 ms micro-sleep — never risks rebalance
                self.last_produce_time = time.time()

            produce_with_retry(
                self.producer,
                "decoded-signals",
                key=session_id.encode("utf-8"),
                value=json.dumps(decoded).encode("utf-8"),
                on_delivery=delivery_report,
            )
            self.producer.poll(0)
            self.decoded_count += 1
            log.debug(
                "[DECODER] #%d session=%s msg=%s name=%s signals=%d ts=%.3f",
                self.decoded_count,
                decoded["session_id"][:8],
                decoded["msg_id"],
                decoded["msg_name"],
                len(decoded["signals"]),
                decoded["timestamp"],
            )
            if self.decoded_count % 100 == 0:
                log.info(
                    "Decoded %d frames | Last: %s (%d signals)",
                    self.decoded_count,
                    decoded["msg_name"],
                    len(decoded["signals"]),
                )

        except json.JSONDecodeError as e:
            self.error_count += 1
            log.error(
                "Invalid JSON — discarding message. error=%s payload=%r",
                e, raw_json[:200],
            )
        except Exception as e:
            self.error_count += 1
            log.error(
                "Failed to decode frame — discarding message. error=%s payload=%r",
                e, raw_json[:200],
            )

    def run(self) -> None:
        """Main consume/decode/produce loop."""
        self.running = True

        signal.signal(signal.SIGINT, self._handle_stop)
        signal.signal(signal.SIGTERM, self._handle_stop)

        self.consumer.subscribe(["raw-can-frames"])
        log.info("Subscribed to raw-can-frames — waiting for messages...")

        log.info("=== CAN Decoder Service ===")
        log.info("Catalog  : %s (%d messages)", self.args.catalogues, len(self.catalog))
        log.info("Kafka    : %s", self.args.kafka)
        log.info("Group    : %s", self.args.group)
        log.info("Input    : raw-can-frames")
        log.info("Output   : decoded-signals")
        log.info("Press Ctrl+C to stop")

        try:
            while self.running:
                self._maybe_reload_catalog()
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
                    try:
                        self._process_message(raw_json, session_key)
                    except Exception as e:
                        # _process_message catches all errors internally; this guard
                        # is a last-resort safety net for unexpected exceptions.
                        self.error_count += 1
                        log.error(
                            "Unhandled error in _process_message — "
                            "message will be discarded: %s", e
                        )
                    finally:
                        # Always commit — dead-letter discard ensures a corrupted
                        # offset never blocks the consumer indefinitely.
                        self.consumer.commit(msg)

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
        default="127.0.0.1:9092",
        help="Kafka bootstrap servers (default: 127.0.0.1:9092)",
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
