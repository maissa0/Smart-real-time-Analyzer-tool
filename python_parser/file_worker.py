"""
file_worker.py — File processing worker for KPIT Smart Real-Time CAN Analyser

Consumes file processing jobs from the file-processing-jobs Kafka topic,
parses CAN log files of any supported format, and publishes raw frames
to the raw-can-frames Kafka topic for decoding.

Supported formats:
    .txt, .log, .asc  — ASCII CAN log format (via log_parser.py)
    .blf              — Vector Binary Logging Format (via static_parser.py)

Usage:
    python file_worker.py --kafka localhost:9092 --catalogues catalogues
    python file_worker.py --kafka localhost:9092 --catalogues catalogues --group file-workers
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import time
import uuid
from pathlib import Path

from confluent_kafka import Consumer, Producer, KafkaError

from log_parser import get_ascii_metadata, parse_log, parse_log_stream
from static_parser import parse_blf, get_blf_metadata
from xml_decoder import load_catalog

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [file_worker] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ── Kafka helpers ──────────────────────────────────────────────────────────────

def make_consumer(bootstrap_servers: str, group_id: str) -> Consumer:
    return Consumer({
        "bootstrap.servers": bootstrap_servers,
        "group.id": group_id,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
    })


def make_producer(bootstrap_servers: str) -> Producer:
    return Producer({
        "bootstrap.servers": bootstrap_servers,
        "linger.ms": 1,
        "compression.type": "lz4",
    })


def delivery_report(err, msg) -> None:
    if err:
        log.error("Delivery failed for topic %s: %s", msg.topic(), err)


# ── Session meta publisher ─────────────────────────────────────────────────────

def publish_session_meta(
    producer: Producer,
    session_id: str,
    source_filename: str,
    start_ts: float,
    end_ts: float,
    frame_count: int,
    car_uid: str = "",
) -> None:
    """Publish session-meta so Spring Boot creates the session row."""
    meta = {
        "session_id": session_id,
        "source_filename": source_filename,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "frame_count": frame_count,
    }
    if car_uid:
        meta["car_uid"] = car_uid
    producer.produce(
        "session-meta",
        key=session_id.encode("utf-8"),
        value=json.dumps(meta).encode("utf-8"),
        on_delivery=delivery_report,
    )
    producer.flush()
    log.info("Session meta published: %s (%d frames)", session_id, frame_count)


# ── Raw frame publisher ────────────────────────────────────────────────────────

def publish_raw_frame(producer: Producer, frame: dict, session_id: str) -> None:
    """Publish one raw frame to raw-can-frames topic."""
    payload = {
        "session_id": session_id,
        "timestamp": frame.get("timestamp", 0.0),
        "channel": frame.get("channel", 1),
        "channel_name": frame.get("channel_name", ""),
        "msg_id": frame.get("msg_id", ""),
        "msg_name": frame.get("msg_name", "UNKNOWN"),
        "raw_bytes": frame.get("raw_bytes", []),
        "direction": frame.get("direction", "Rx"),
        "frame_seq": frame.get("frame_seq", 0),
    }
    producer.produce(
        "raw-can-frames",
        key=session_id.encode("utf-8"),
        value=json.dumps(payload).encode("utf-8"),
        on_delivery=delivery_report,
    )


def publish_log_file_event(producer: Producer, event: dict) -> None:
    """Publish a log file lifecycle event to log-file-events topic."""
    session_id = event.get("session_id", "unknown")
    producer.produce(
        "log-file-events",
        key=session_id.encode("utf-8"),
        value=json.dumps(event).encode("utf-8"),
        on_delivery=delivery_report,
    )
    producer.flush()


# ── File processor ─────────────────────────────────────────────────────────────

class FileProcessingWorker:
    """Consumes file-processing-jobs and publishes raw frames to raw-can-frames."""

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.running = False
        self.processed_count = 0
        self.error_count = 0

        log.info("Loading catalog from: %s", args.catalogues)
        self.catalog = load_catalog(Path(args.catalogues))
        log.info("Catalog loaded — %d messages", len(self.catalog))

        log.info("Connecting to Kafka: %s", args.kafka)
        self.consumer = make_consumer(args.kafka, args.group)
        self.producer = make_producer(args.kafka)

    def _detect_format(self, file_path: Path) -> str:
        """Detect file format from extension."""
        suffix = file_path.suffix.lower()
        if suffix in (".txt", ".log", ".asc"):
            return "ascii"
        elif suffix == ".blf":
            return "blf"
        else:
            raise ValueError(f"Unsupported file format: {suffix}")

    def _process_ascii_file(
        self, file_path: Path, session_id: str, source_filename: str, car_uid: str = ""
    ) -> int:
        """Parse ASCII CAN log and publish frames. Returns frame count."""
        log.info("Extracting metadata from ASCII log: %s", file_path.name)

        # Fast metadata extraction before full parse
        metadata = get_ascii_metadata(file_path)

        # Publish metadata event to log-file-events
        publish_log_file_event(self.producer, {
            "event": "metadata",
            "session_id": session_id,
            "filename": source_filename,
            "file_size": metadata["file_size"],
            "format": metadata["format"],
            "channel_count": metadata["channel_count"],
            "frame_count": metadata["frame_count_estimate"],
            "start_ts": metadata["start_ts"],
            "end_ts": metadata["end_ts"],
            "duration_seconds": round(
                metadata["end_ts"] - metadata["start_ts"], 3
            ) if metadata["end_ts"] > metadata["start_ts"] else 0.0,
        })

        try:
            log.info("Streaming ASCII log: %s (line-by-line, memory-flat)", file_path.name)
            # Use metadata timestamps for session meta — extracted cheaply above
            start_ts = metadata.get("start_ts", 0.0)
            end_ts   = metadata.get("end_ts", 0.0)
            # Publish session meta before streaming frames
            publish_session_meta(
                self.producer,
                session_id,
                source_filename,
                start_ts,
                end_ts,
                0,  # Spring Boot increments on each frame received
                car_uid,
            )
            # Stream frames line-by-line — no full file load into RAM
            frame_seq: dict[str, int] = {}
            frame_count = 0
            for frame in parse_log_stream(file_path, self.catalog, session_id):
                msg_id = frame.msg_id
                seq = frame_seq.get(msg_id, -1) + 1
                frame_seq[msg_id] = seq
                raw_frame = {
                    "session_id": session_id,
                    "timestamp": frame.timestamp,
                    "channel": frame.channel,
                    "channel_name": frame.channel_name,
                    "msg_id": frame.msg_id,
                    "msg_name": frame.msg_name,
                    "raw_bytes": frame.raw_bytes,
                    "direction": frame.direction,
                    "frame_seq": seq,
                }
                publish_raw_frame(self.producer, raw_frame, session_id)
                frame_count += 1
                if frame_count % 1000 == 0:
                    self.producer.poll(0)
                    log.info("Streamed %d frames for session %s", frame_count, session_id)
            self.producer.flush()
            # Publish completion event
            publish_log_file_event(self.producer, {
                "event": "complete",
                "session_id": session_id,
                "frame_count": frame_count,
            })
            return frame_count

        except Exception as e:
            # Publish error event
            publish_log_file_event(self.producer, {
                "event": "error",
                "session_id": session_id,
                "error": str(e),
            })
            raise

    def _process_blf_file(
        self, file_path: Path, session_id: str, source_filename: str, car_uid: str = ""
    ) -> int:
        """Parse BLF file and publish frames. Returns frame count."""
        import os
        log.info("Extracting metadata from BLF file: %s", file_path.name)

        # Get BLF metadata (reads full file — BLF has no fast header scan)
        metadata = get_blf_metadata(file_path)
        file_size = os.path.getsize(file_path)

        # Publish metadata event
        publish_log_file_event(self.producer, {
            "event": "metadata",
            "session_id": session_id,
            "filename": source_filename,
            "file_size": file_size,
            "format": "blf",
            "channel_count": 1,  # BLF channel count determined during streaming
            "frame_count": metadata["frame_count"],
            "start_ts": metadata["start_ts"],
            "end_ts": metadata["end_ts"],
            "duration_seconds": round(
                metadata["end_ts"] - metadata["start_ts"], 3
            ) if metadata["end_ts"] > metadata["start_ts"] else 0.0,
        })

        try:
            # Publish session meta
            publish_session_meta(
                self.producer,
                session_id,
                source_filename,
                metadata["start_ts"],
                metadata["end_ts"],
                0,  # start at 0 — Spring Boot increments on each frame
                car_uid,
            )

            # Stream frames
            frame_count = 0
            for raw_frame in parse_blf(file_path, self.catalog, session_id):
                publish_raw_frame(self.producer, raw_frame, session_id)
                frame_count += 1

                if frame_count % 1000 == 0:
                    self.producer.poll(0)
                    log.info("Published %d frames for session %s", frame_count, session_id)

            self.producer.flush()

            # Publish completion event
            publish_log_file_event(self.producer, {
                "event": "complete",
                "session_id": session_id,
                "frame_count": frame_count,
            })

            return frame_count

        except Exception as e:
            publish_log_file_event(self.producer, {
                "event": "error",
                "session_id": session_id,
                "error": str(e),
            })
            raise

    def _process_job(self, job: dict) -> None:
        """Process one file processing job."""
        session_id = job.get("session_id", str(uuid.uuid4()))
        file_path_str = job.get("file_path", "")
        source_filename = job.get("source_filename", "unknown")
        catalogues_dir = job.get("catalogues_dir", self.args.catalogues)
        car_uid = job.get("car_uid", "") or ""

        log.info(
            "Processing job — session=%s file=%s",
            session_id,
            source_filename,
        )

        file_path = Path(file_path_str)
        if not file_path.exists():
            log.error("File not found: %s", file_path)
            self.error_count += 1
            return

        # Reload catalog if job specifies different catalogues dir
        catalog = self.catalog
        if catalogues_dir != self.args.catalogues:
            log.info("Loading catalog from job-specified dir: %s", catalogues_dir)
            catalog = load_catalog(Path(catalogues_dir))
            self.catalog = catalog

        try:
            fmt = self._detect_format(file_path)
            if fmt == "ascii":
                frame_count = self._process_ascii_file(
                    file_path, session_id, source_filename, car_uid
                )
            elif fmt == "blf":
                frame_count = self._process_blf_file(
                    file_path, session_id, source_filename, car_uid
                )
            else:
                raise ValueError(f"Unknown format: {fmt}")

            self.processed_count += 1
            log.info(
                "Job complete — session=%s frames=%d format=%s",
                session_id,
                frame_count,
                fmt,
            )

        except Exception as e:
            self.error_count += 1
            log.error(
                "Job failed — session=%s file=%s error=%s",
                session_id,
                source_filename,
                e,
            )

    def run(self) -> None:
        """Main job consumer loop."""
        self.running = True

        signal.signal(signal.SIGINT, self._handle_stop)
        signal.signal(signal.SIGTERM, self._handle_stop)

        self.consumer.subscribe(["file-processing-jobs"])
        log.info("Subscribed to file-processing-jobs — waiting for jobs...")

        print(f"\n=== File Processing Worker ===")
        print(f"Catalog  : {self.args.catalogues} ({len(self.catalog)} messages)")
        print(f"Kafka    : {self.args.kafka}")
        print(f"Group    : {self.args.group}")
        print(f"Formats  : .txt, .log, .asc, .blf")
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

                try:
                    job = json.loads(msg.value().decode("utf-8"))
                    self._process_job(job)
                    # Commit only after successful job processing.
                    # If _process_job raises, offset is NOT committed —
                    # the job will be redelivered on next worker start,
                    # preventing silent data loss on crash.
                    self.consumer.commit(msg)
                except json.JSONDecodeError as e:
                    log.error("Invalid job JSON: %s — offset NOT committed", e)
                    self.error_count += 1
                except Exception as e:
                    log.error(
                        "Failed to process job — offset NOT committed "
                        "(will retry on restart): %s", e
                    )
                    self.error_count += 1

        finally:
            self.consumer.close()
            self.producer.flush()
            log.info(
                "Worker stopped — processed: %d jobs, errors: %d",
                self.processed_count,
                self.error_count,
            )

    def _handle_stop(self, signum, frame) -> None:
        log.info("Stop signal received — shutting down...")
        self.running = False


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="File processing worker — consumes jobs, publishes raw frames"
    )
    parser.add_argument(
        "--kafka",
        default="localhost:9092",
        help="Kafka bootstrap servers (default: localhost:9092)",
    )
    parser.add_argument(
        "--catalogues",
        default="./catalogues",
        help="Path to XML catalog directory (default: ./catalogues)",
    )
    parser.add_argument(
        "--group",
        default="file-workers",
        help="Kafka consumer group ID (default: file-workers)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    worker = FileProcessingWorker(args)
    worker.run()
