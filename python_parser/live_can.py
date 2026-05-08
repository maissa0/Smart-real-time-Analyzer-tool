"""
live_can.py — Live CAN bus reader for KPIT Smart Real-Time CAN Analyser

Reads raw CAN frames from a real CAN adapter using python-can,
decodes signals using the XML catalog, and publishes to Kafka.

Usage:
    python live_can.py --interface socketcan --channel vcan0 --catalogues catalogues --kafka localhost:9092
    python live_can.py --interface vector --channel 0 --catalogues catalogues --kafka localhost:9092
    python live_can.py --interface pcan --channel PCAN_USBBUS1 --catalogues catalogues --kafka localhost:9092
    python live_can.py --interface virtual --channel 0 --catalogues catalogues --kafka localhost:9092

Supported interfaces (via python-can):
    socketcan  — Linux SocketCAN (vcan0, can0, etc.)
    vector     — Vector CANalyzer/CANcase hardware
    pcan       — PEAK PCAN USB adapters
    kvaser     — Kvaser hardware
    virtual    — Virtual bus for testing (no hardware needed)
"""

import argparse
import json
import logging
import signal
import sys
import time
import uuid
from pathlib import Path

import can
from confluent_kafka import Producer

from models import DecodedFrame
from xml_decoder import load_catalog, decode_frame, _msg_id_key

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [live_can] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ── Kafka helpers ──────────────────────────────────────────────────────────────


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


def publish_session_meta(
    producer: Producer,
    session_id: str,
    start_ts: float,
    source: str = "live_can",
) -> None:
    """Publish session-meta to Kafka so Spring Boot creates the session row."""
    meta = {
        "session_id": session_id,
        "source_filename": source,
        "start_ts": start_ts,
        "end_ts": start_ts + 86400,
        "frame_count": 0,
    }
    producer.produce(
        "session-meta",
        key=session_id.encode("utf-8"),
        value=json.dumps(meta).encode("utf-8"),
        on_delivery=delivery_report,
    )
    producer.flush()
    log.info("Session published: %s", session_id)


def publish_frame(producer: Producer, frame: DecodedFrame, session_id: str) -> None:
    """Publish one raw CAN frame to the raw-can-frames Kafka topic."""
    raw_payload = {
        "session_id": session_id,
        "timestamp": frame.timestamp,
        "channel": frame.channel,
        "channel_name": frame.channel_name,
        "msg_id": frame.msg_id,
        "msg_name": frame.msg_name,
        "raw_bytes": frame.raw_bytes,
        "direction": frame.direction,
    }
    producer.produce(
        "raw-can-frames",
        key=session_id.encode("utf-8"),
        value=json.dumps(raw_payload).encode("utf-8"),
        on_delivery=delivery_report,
    )


# ── Main reader class ──────────────────────────────────────────────────────────


class LiveCanReader:
    """Reads CAN frames from a hardware adapter, decodes, and publishes to Kafka."""

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.session_id = args.session_id or str(uuid.uuid4())
        self.running = False
        self.frame_count = 0
        self.start_ts = 0.0

        log.info("Loading catalog from: %s", args.catalogues)
        self.catalog = load_catalog(Path(args.catalogues))
        log.info("Catalog loaded — %d messages", len(self.catalog))

        log.info("Connecting to Kafka: %s", args.kafka)
        self.producer = make_producer(args.kafka)

    def _make_can_bus(self) -> can.BusABC:
        """Create a python-can Bus instance from CLI args."""
        log.info(
            "Opening CAN bus — interface=%s channel=%s bitrate=%d",
            self.args.interface,
            self.args.channel,
            self.args.bitrate,
        )
        return can.Bus(
            interface=self.args.interface,
            channel=self.args.channel,
            bitrate=self.args.bitrate,
        )

    def _process_message(self, msg: can.Message) -> None:
        """Decode one raw CAN message and publish it to Kafka."""
        msg_id_hex = f"0x{msg.arbitration_id:03X}"
        msg_id_key = _msg_id_key(msg_id_hex)

        raw_bytes = list(msg.data)
        decoded_signals = decode_frame(msg_id_hex, raw_bytes, self.catalog)

        if msg_id_key in self.catalog:
            msg_def = self.catalog[msg_id_key]
            msg_name = msg_def.msg_name
            channel_name = msg_def.bus_name
        else:
            msg_name = "UNKNOWN"
            channel_name = "Unknown"

        frame = DecodedFrame(
            timestamp=msg.timestamp if msg.timestamp else time.time(),
            channel=1,
            channel_name=channel_name,
            msg_id=msg_id_hex,
            msg_name=msg_name,
            raw_bytes=raw_bytes,
            signals=decoded_signals,
            direction="Tx" if msg.is_remote_frame else "Rx",
        )

        publish_frame(self.producer, frame, self.session_id)
        self.frame_count += 1

        if self.frame_count % 100 == 0:
            self.producer.poll(0)
            log.info(
                "Frames published: %d | Last: %s (%d signals)",
                self.frame_count,
                msg_name,
                len(decoded_signals),
            )

    def run(self) -> None:
        """Main read loop — blocks until Ctrl+C or stop() is called."""
        self.running = True
        self.start_ts = time.time()

        signal.signal(signal.SIGINT, self._handle_stop)
        signal.signal(signal.SIGTERM, self._handle_stop)

        publish_session_meta(
            self.producer,
            self.session_id,
            self.start_ts,
            source=f"live_{self.args.interface}_{self.args.channel}",
        )

        print(f"\n=== Live CAN Reader ===")
        print(f"Session  : {self.session_id}")
        print(f"Interface: {self.args.interface}")
        print(f"Channel  : {self.args.channel}")
        print(f"Bitrate  : {self.args.bitrate}")
        print(f"Kafka    : {self.args.kafka}")
        print(f"Press Ctrl+C to stop\n")

        bus = None
        try:
            bus = self._make_can_bus()
            log.info("CAN bus opened successfully")

            while self.running:
                msg = bus.recv(timeout=1.0)
                if msg is None:
                    continue
                if msg.is_error_frame:
                    log.warning("CAN error frame received — skipping")
                    continue
                self._process_message(msg)

        except can.CanError as e:
            log.error("CAN bus error: %s", e)
            log.error("Check that your CAN interface is connected and configured")
            sys.exit(1)
        except Exception as e:
            log.error("Unexpected error: %s", e)
            raise
        finally:
            if bus:
                bus.shutdown()
                log.info("CAN bus closed")
            self.producer.flush()
            log.info(
                "Session %s complete — %d frames published",
                self.session_id,
                self.frame_count,
            )

    def _handle_stop(self, signum, frame) -> None:
        log.info("Stop signal received — flushing and shutting down...")
        self.running = False

    def stop(self) -> None:
        self.running = False


# ── CLI ────────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Live CAN bus reader — reads from hardware, decodes, publishes to Kafka"
    )
    parser.add_argument(
        "--interface",
        default="socketcan",
        choices=["socketcan", "vector", "pcan", "kvaser", "virtual", "usb2can", "ixxat"],
        help="python-can interface type (default: socketcan)",
    )
    parser.add_argument(
        "--channel",
        default="vcan0",
        help="CAN channel (e.g. vcan0, can0, PCAN_USBBUS1, 0) (default: vcan0)",
    )
    parser.add_argument(
        "--bitrate",
        type=int,
        default=500000,
        help="CAN bus bitrate in bps (default: 500000)",
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
        "--session-id",
        default=None,
        help="Session ID override (default: random UUID)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    reader = LiveCanReader(args)
    reader.run()
