"""
file_worker.py — File processing worker for KPIT Smart Real-Time CAN Analyser

Consumes file processing jobs from the file-processing-jobs Kafka topic,
parses CAN log files of any supported format, and publishes raw frames
to the raw-can-frames Kafka topic for decoding.

Supported formats:
    .txt, .log, .asc  — ASCII CAN log format (via log_parser.py)
    .blf              — Vector Binary Logging Format (via static_parser.py)

Usage:
    python file_worker.py --kafka 127.0.0.1:9092 --catalogues catalogues
    python file_worker.py --kafka 127.0.0.1:9092 --catalogues catalogues --group file-workers
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


def produce_with_retry(producer: Producer, topic: str, *, key: bytes, value: bytes, on_delivery) -> None:
    """produce() raises BufferError when librdkafka's local queue is full. Poll to free space
    and retry once instead of letting a transient full-queue condition crash the worker."""
    try:
        producer.produce(topic, key=key, value=value, on_delivery=on_delivery)
    except BufferError:
        log.warning("Kafka local queue full for topic %s — polling and retrying once", topic)
        producer.poll(1)
        producer.produce(topic, key=key, value=value, on_delivery=on_delivery)


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
    produce_with_retry(
        producer,
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
    if frame.get("catalog_files"):
        # Session catalog scope — lets decoder.py decode with the same subset
        payload["catalog_files"] = frame["catalog_files"]
    produce_with_retry(
        producer,
        "raw-can-frames",
        key=session_id.encode("utf-8"),
        value=json.dumps(payload).encode("utf-8"),
        on_delivery=delivery_report,
    )


def publish_log_file_event(producer: Producer, event: dict) -> None:
    """Publish a log file lifecycle event to log-file-events topic."""
    session_id = event.get("session_id", "unknown")
    produce_with_retry(
        producer,
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

        # Kafka job fields (file_path, catalogues_dir) are untrusted input — anyone able to
        # publish to file-processing-jobs (or a bug upstream in the Java producer) could point
        # them anywhere on disk. Every path from a job is resolved and checked against these
        # roots before use; jobs referencing anything outside are rejected, not read.
        self.uploads_root = Path(args.uploads_dir).resolve()
        self.catalogues_root = Path(args.catalogues).resolve().parent

        log.info("Loading catalog from: %s", args.catalogues)
        self.catalog = load_catalog(Path(args.catalogues))
        log.info("Catalog loaded — %d messages", len(self.catalog))

        log.info("Connecting to Kafka: %s", args.kafka)
        self.consumer = make_consumer(args.kafka, args.group)
        self.producer = make_producer(args.kafka)

    @staticmethod
    def _resolve_within(path_str: str, root: Path, what: str) -> Path:
        """Resolve `path_str` and ensure it lies within `root`. Raises ValueError otherwise."""
        resolved = Path(path_str).resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError(f"{what} '{path_str}' escapes allowed root '{root}'")
        return resolved

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
        self, file_path: Path, session_id: str, source_filename: str, car_uid: str = "",
        catalog: dict | None = None, catalog_files: list[str] | None = None,
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
            for frame in parse_log_stream(file_path, catalog or self.catalog, session_id):
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
                if catalog_files:
                    raw_frame["catalog_files"] = catalog_files
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
        self, file_path: Path, session_id: str, source_filename: str, car_uid: str = "",
        catalog: dict | None = None, catalog_files: list[str] | None = None,
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
            for raw_frame in parse_blf(file_path, catalog or self.catalog, session_id):
                if catalog_files:
                    raw_frame["catalog_files"] = catalog_files
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

        try:
            file_path = self._resolve_within(file_path_str, self.uploads_root, "file_path")
        except ValueError as e:
            log.error("Rejected job — %s", e)
            self.error_count += 1
            return
        if not file_path.exists():
            log.error("File not found: %s", file_path)
            self.error_count += 1
            return

        # Reload catalog if job specifies different catalogues dir
        catalog = self.catalog
        effective_cat_dir = Path(self.args.catalogues)
        if catalogues_dir != self.args.catalogues:
            try:
                validated_catalogues_dir = self._resolve_within(
                    catalogues_dir, self.catalogues_root, "catalogues_dir"
                )
            except ValueError as e:
                log.error("Rejected job — %s", e)
                self.error_count += 1
                return
            log.info("Loading catalog from job-specified dir: %s", validated_catalogues_dir)
            catalog = load_catalog(validated_catalogues_dir)
            self.catalog = catalog
            effective_cat_dir = validated_catalogues_dir

        # Session catalog scope from the car's assignment (Java resolves it) —
        # parse this session with only those files and stamp them on each frame
        # so decoder.py decodes with the same subset.
        raw_scope = job.get("catalog_files") or []
        scoped_files = (
            {str(f).strip() for f in raw_scope if str(f).strip()}
            if isinstance(raw_scope, list) else set()
        )
        catalog_files = sorted(scoped_files)
        if scoped_files:
            catalog = load_catalog(effective_cat_dir, only_files=scoped_files)
            log.info(
                "Session %s scoped to catalogs %s — %d messages",
                session_id, catalog_files, len(catalog),
            )

        try:
            fmt = self._detect_format(file_path)
            if fmt == "ascii":
                frame_count = self._process_ascii_file(
                    file_path, session_id, source_filename, car_uid,
                    catalog=catalog, catalog_files=catalog_files,
                )
            elif fmt == "blf":
                frame_count = self._process_blf_file(
                    file_path, session_id, source_filename, car_uid,
                    catalog=catalog, catalog_files=catalog_files,
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

        log.info("=== File Processing Worker ===")
        log.info("Catalog  : %s (%d messages)", self.args.catalogues, len(self.catalog))
        log.info("Kafka    : %s", self.args.kafka)
        log.info("Group    : %s", self.args.group)
        log.info("Formats  : .txt, .log, .asc, .blf")
        log.info("Press Ctrl+C to stop")

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
        default="127.0.0.1:9092",
        help="Kafka bootstrap servers (default: 127.0.0.1:9092)",
    )
    parser.add_argument(
        "--catalogues",
        default="./catalogues",
        help="Path to XML catalog directory (default: ./catalogues)",
    )
    parser.add_argument(
        "--uploads-dir",
        default="../uploads",
        help="Allowed root directory for job file_path values (default: ../uploads). "
             "Jobs referencing a file_path outside this directory are rejected.",
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
