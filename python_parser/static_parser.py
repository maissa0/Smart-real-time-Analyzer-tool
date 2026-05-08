"""
static_parser.py — BLF (Binary Logging Format) file parser

Reads Vector BLF binary CAN log files using python-can's BLFReader
and converts each message to the standard raw frame payload format
compatible with the raw-can-frames Kafka topic.

Supported formats:
    .blf — Vector Binary Logging Format (most common automotive format)

Usage (standalone):
    python static_parser.py --file path/to/log.blf --catalogues catalogues

Usage (from file_worker.py):
    from static_parser import parse_blf
    frames = parse_blf(file_path, catalog)
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Generator

import can

from models import DecodedFrame
from xml_decoder import _msg_id_key

log = logging.getLogger(__name__)


def parse_blf(
    file_path: Path,
    catalog: dict,
    session_id: str = "",
) -> Generator[dict, None, None]:
    """
    Parse a BLF file and yield raw frame payload dicts for each CAN message.

    Each yielded dict matches the raw-can-frames Kafka topic format:
    {
        session_id: str,
        timestamp: float,
        channel: int,
        channel_name: str,
        msg_id: str,
        msg_name: str,
        raw_bytes: list[int],
        direction: str,
        frame_seq: int,  # per msg_id sequence counter
    }

    Args:
        file_path: Path to the .blf file
        catalog: Loaded catalog dict from load_catalog()
        session_id: Session identifier

    Yields:
        Raw frame payload dicts
    """
    frame_seq: dict[str, int] = {}  # per msg_id sequence counter

    log.info("Parsing BLF file: %s", file_path)

    try:
        with can.BLFReader(str(file_path)) as reader:
            frame_count = 0
            for msg in reader:
                # Skip error frames and remote frames
                if msg.is_error_frame or msg.is_remote_frame:
                    continue

                # Build hex message ID string
                msg_id_hex = f"0x{msg.arbitration_id:03X}"
                msg_id_key = _msg_id_key(msg_id_hex)

                # Resolve message name and bus name from catalog
                if msg_id_key in catalog:
                    msg_def = catalog[msg_id_key]
                    msg_name = msg_def.msg_name
                    channel_name = msg_def.bus_name
                else:
                    msg_name = "UNKNOWN"
                    channel_name = "Unknown"
                    log.debug(
                        "Unknown ECU — frame ID %s not in catalog", msg_id_hex
                    )

                # Increment per-msg_id sequence counter
                seq = frame_seq.get(msg_id_hex, -1) + 1
                frame_seq[msg_id_hex] = seq

                raw_bytes = list(msg.data)

                payload = {
                    "session_id": session_id,
                    "timestamp": msg.timestamp,
                    "channel": msg.channel if msg.channel is not None else 1,
                    "channel_name": channel_name,
                    "msg_id": msg_id_hex,
                    "msg_name": msg_name,
                    "raw_bytes": raw_bytes,
                    "direction": "Rx",
                    "frame_seq": seq,
                }

                frame_count += 1
                yield payload

            log.info(
                "BLF parsing complete — %d frames from %s", frame_count, file_path.name
            )

    except FileNotFoundError:
        log.error("BLF file not found: %s", file_path)
        raise
    except Exception as e:
        log.error("Failed to parse BLF file %s: %s", file_path, e)
        raise


def get_blf_metadata(file_path: Path) -> dict:
    """
    Extract metadata from a BLF file header — instantaneous, no full file scan.

    Uses python-can's BLFReader header attributes (start_timestamp, stop_timestamp,
    object_count) which are populated from the file header without iterating messages.
    File size is read from the OS — no file content needed.

    Args:
        file_path: Path to the .blf file

    Returns:
        dict with keys: start_ts, end_ts, frame_count, file_size
    """
    import os

    file_size = os.path.getsize(file_path)

    try:
        with can.BLFReader(str(file_path)) as reader:
            # These attributes come from the BLF file header — no iteration needed
            start_ts = reader.start_timestamp or 0.0
            end_ts = reader.stop_timestamp or 0.0
            # object_count includes all objects (frames + other events)
            # Use as frame_count estimate — actual CAN frame count may be slightly less
            frame_count = getattr(reader, 'object_count', 0) or 0

        return {
            "start_ts": float(start_ts),
            "end_ts": float(end_ts),
            "frame_count": int(frame_count),
            "file_size": file_size,
        }

    except Exception as e:
        log.error("Failed to read BLF metadata from header: %s", e)
        return {
            "start_ts": 0.0,
            "end_ts": 0.0,
            "frame_count": 0,
            "file_size": file_size,
        }


if __name__ == "__main__":
    import argparse
    from xml_decoder import load_catalog

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [static_parser] %(levelname)s %(message)s",
    )

    parser = argparse.ArgumentParser(description="BLF file parser — test mode")
    parser.add_argument("--file", type=Path, required=True, help="Path to .blf file")
    parser.add_argument(
        "--catalogues",
        type=Path,
        default=Path("./catalogues"),
        help="Catalog directory",
    )
    parser.add_argument(
        "--limit", type=int, default=10, help="Max frames to print (default: 10)"
    )
    args = parser.parse_args()

    catalog = load_catalog(args.catalogues)
    log.info("Catalog loaded — %d messages", len(catalog))

    metadata = get_blf_metadata(args.file)
    log.info("BLF metadata: %s", metadata)

    count = 0
    for frame in parse_blf(args.file, catalog, session_id="test"):
        print(
            f"  [{count+1}] {frame['msg_name']} @ {frame['timestamp']:.3f}s "
            f"id={frame['msg_id']} bytes={frame['raw_bytes'][:4]}..."
        )
        count += 1
        if count >= args.limit:
            print(f"  ... (showing first {args.limit} frames)")
            break
