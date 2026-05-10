"""CLI entry: load catalog, parse CAN log, optionally publish to Kafka."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid
from dataclasses import asdict
from pathlib import Path

from confluent_kafka import Producer

from log_parser import parse_log
from models import ParsedSession
from xml_decoder import load_catalog


def _delivery_report(err, msg) -> None:
    """Log Kafka produce errors to the configured logging handlers."""
    if err is not None:
        logging.error("Kafka delivery failed: %s", err)


def publish_session(session: ParsedSession, bootstrap_servers: str = "localhost:9092") -> None:
    """Send session summary to session-meta and each frame to raw-can-frames."""
    producer = Producer(
        {
            "bootstrap.servers": bootstrap_servers,
            "linger.ms": 1,
            "compression.type": "lz4",
        }
    )
    key = session.session_id
    full = asdict(session)
    meta = {k: full[k] for k in ("session_id", "source_filename", "start_ts", "end_ts", "frame_count")}
    producer.produce(
        "session-meta",
        key=key.encode("utf-8"),
        value=json.dumps(meta).encode("utf-8"),
        on_delivery=_delivery_report,
    )
    for frame in session.frames:
        raw_payload = {
            "session_id": key,
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
            key=key.encode("utf-8"),
            value=json.dumps(raw_payload).encode("utf-8"),
            on_delivery=_delivery_report,
        )
    producer.flush()


def main() -> None:
    """Parse arguments, run parse and optional Kafka publish, print summary."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description="CAN log pipeline: catalog → parse → Kafka")
    p.add_argument("--log", type=Path, required=True, help="Path to CAN log .txt file")
    default_cat = Path(__file__).resolve().parent / "catalogues"
    p.add_argument(
        "--catalogues",
        type=Path,
        default=default_cat,
        help="Directory containing catalogue XML files",
    )
    p.add_argument(
        "--session-id",
        default=str(uuid.uuid4()),
        help="Session identifier for Kafka keys and ParsedSession",
    )
    p.add_argument(
        "--kafka",
        default="localhost:9092",
        help="Kafka bootstrap servers",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse only; do not publish to Kafka",
    )
    args = p.parse_args()
    try:
        catalog = load_catalog(args.catalogues)
        session = parse_log(args.log, catalog, args.session_id)
        if not args.dry_run:
            publish_session(session, bootstrap_servers=args.kafka)
            print(
                f"Session {session.session_id}: {session.frame_count} frames published to Kafka."
            )
        else:
            print(
                f"Session {session.session_id}: {session.frame_count} frames parsed (dry-run, Kafka skipped)."
            )
    except Exception:
        logging.exception("Pipeline failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
