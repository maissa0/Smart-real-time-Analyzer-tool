"""Publish a parsed CAN session to Kafka (metadata topic + per-frame topic)."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict

from confluent_kafka import Producer

from models import ParsedSession


def _delivery_report(err, msg) -> None:
    """Log Kafka produce errors to the configured logging handlers."""
    if err is not None:
        logging.error("Kafka delivery failed: %s", err)


def publish_session(session: ParsedSession, bootstrap_servers: str = "localhost:9092") -> None:
    """Send session summary to session-meta and each frame to decoded-frames."""
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
