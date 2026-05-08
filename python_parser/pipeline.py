"""CLI entry: load catalog, parse CAN log, optionally publish to Kafka."""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from pathlib import Path

from kafka_producer import publish_session
from log_parser import parse_log
from xml_decoder import load_catalog


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
