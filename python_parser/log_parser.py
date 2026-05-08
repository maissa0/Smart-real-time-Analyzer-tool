"""Parse ASCII CAN log files into a ParsedSession using a message catalog."""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import asdict
from pathlib import Path

from models import DecodedFrame, MessageDefinition, ParsedSession
from xml_decoder import _msg_id_key, decode_frame, load_catalog

_HEADER_RE = re.compile(r"CAN (\d+): (.+)")
_LINE_RE = re.compile(
    r"^([\d.]+)\s+(\d+)\s+(0x[0-9A-Fa-f]+)\s+(Tx|Rx)\s+d\s+(\d+)\s+\[([^\]]+)\]"
)


def get_ascii_metadata(log_path: Path) -> dict:
    """
    Fast metadata extraction from an ASCII CAN log file.

    Reads only the first 100 lines and last 100 lines of the file
    to extract timestamps and channel info without full parsing.

    Returns:
        dict with keys:
            file_size: int (bytes)
            start_ts: float (first frame timestamp)
            end_ts: float (last frame timestamp)
            channel_count: int (number of CAN channels found)
            channel_names: list[str]
            frame_count_estimate: int (approximate, from line count)
            format: str ("ascii")
    """

    # Regex patterns
    frame_pattern = re.compile(
        r'^\s*(\d+\.\d+)\s+(\d+)\s+([\dA-Fa-fXx]+)\s+(Tx|Rx)\s+d\s+\d+'
    )
    channel_pattern = re.compile(r'^CAN\s+(\d+):\s*(.+)$')

    file_size = os.path.getsize(log_path)
    start_ts = 0.0
    end_ts = 0.0
    channel_names = []
    channels_seen = set()

    try:
        # Read first 100 lines for start timestamp and channel names
        with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
            head_lines = []
            for i, line in enumerate(f):
                head_lines.append(line)
                if i >= 99:
                    break

        for line in head_lines:
            # Extract channel names
            ch_match = channel_pattern.match(line.strip())
            if ch_match:
                ch_num = ch_match.group(1)
                ch_name = ch_match.group(2).strip()
                if ch_num not in channels_seen:
                    channels_seen.add(ch_num)
                    channel_names.append(ch_name)

            # Extract first frame timestamp
            if start_ts == 0.0:
                fr_match = frame_pattern.match(line)
                if fr_match:
                    start_ts = float(fr_match.group(1))

        # Read last 100 lines for end timestamp
        with open(log_path, 'rb') as f:
            # Seek to end and read last chunk
            f.seek(0, 2)  # seek to end
            file_end = f.tell()
            chunk_size = min(8192, file_end)
            f.seek(file_end - chunk_size)
            tail_bytes = f.read(chunk_size)

        tail_lines = tail_bytes.decode('utf-8', errors='replace').splitlines()
        for line in reversed(tail_lines):
            fr_match = frame_pattern.match(line)
            if fr_match:
                end_ts = float(fr_match.group(1))
                break

        # Estimate frame count from file size
        # Average ASCII CAN log line is ~60 bytes
        frame_count_estimate = max(0, file_size // 60)

        return {
            "file_size": file_size,
            "start_ts": start_ts,
            "end_ts": end_ts,
            "channel_count": len(channels_seen) if channels_seen else 1,
            "channel_names": channel_names,
            "frame_count_estimate": frame_count_estimate,
            "format": "ascii",
        }

    except Exception as e:
        return {
            "file_size": file_size,
            "start_ts": 0.0,
            "end_ts": 0.0,
            "channel_count": 0,
            "channel_names": [],
            "frame_count_estimate": 0,
            "format": "ascii",
            "error": str(e),
        }


def parse_log(
    log_path: Path,
    catalog: dict[str, MessageDefinition],
    session_id: str,
) -> ParsedSession:
    """Read a CAN log file, decode known frames, and return a ParsedSession."""
    channel_map: dict[int, str] = {}
    frames: list[DecodedFrame] = []
    text = log_path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        line = line.strip()
        m_h = _HEADER_RE.match(line)
        if m_h:
            channel_map[int(m_h.group(1))] = m_h.group(2).strip()
            continue
        m = _LINE_RE.match(line)
        if not m:
            continue
        timestamp = float(m.group(1))
        channel = int(m.group(2))
        msg_id_raw = m.group(3).strip()
        msg_id = _msg_id_key(msg_id_raw.upper())
        direction = m.group(4)
        dlc = int(m.group(5))
        bytes_str = m.group(6)
        parts = [p.strip() for p in bytes_str.split(",")]
        data_bytes = [int(x) for x in parts if x]
        channel_name = channel_map.get(channel, "")
        msg_def = catalog.get(msg_id)
        if msg_def is not None:
            msg_name = msg_def.msg_name
            signals = list(decode_frame(msg_id_raw, data_bytes, catalog))
        else:
            msg_name = "UNKNOWN"
            signals = []
        payload = data_bytes[:dlc] if dlc <= len(data_bytes) else data_bytes
        frames.append(
            DecodedFrame(
                timestamp=timestamp,
                channel=channel,
                channel_name=channel_name,
                msg_id=msg_id,
                msg_name=msg_name,
                raw_bytes=payload,
                signals=signals,
                direction=direction,
            )
        )
    if not frames:
        start_ts = 0.0
        end_ts = 0.0
    else:
        start_ts = frames[0].timestamp
        end_ts = frames[-1].timestamp
    return ParsedSession(
        session_id=session_id,
        source_filename=log_path.name,
        start_ts=start_ts,
        end_ts=end_ts,
        frame_count=len(frames),
        frames=frames,
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python log_parser.py <log_path> <catalogues_dir>", file=sys.stderr)
        sys.exit(2)
    log_p = Path(sys.argv[1])
    cat_dir = Path(sys.argv[2])
    catalog = load_catalog(cat_dir)
    session = parse_log(log_p, catalog, session_id="cli-main")
    ids = {f.msg_id for f in session.frames}
    print(f"Total frames: {session.frame_count}")
    print(f"Unique message IDs: {len(ids)}")
    for frame in session.frames[:3]:
        print(json.dumps(asdict(frame), indent=2))
