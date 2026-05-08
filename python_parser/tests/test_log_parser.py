"""Tests for CAN log line parsing and unknown frame handling."""

from pathlib import Path

from log_parser import parse_log
from models import MessageDefinition


def test_parse_minimal_log(tmp_path: Path) -> None:
    """Header and two frames produce two DecodedFrames with expected ids and times."""
    log_file = tmp_path / "test.txt"
    log_file.write_text(
        "date Wed Mar 11 13:07:53 2026\n"
        "CAN 1: Car_CAN\n"
        "CAN 2: Key_CAN\n"
        "1773230879.890181  2 0x2FC Rx d 8 [1, 0, 0, 0, 0, 0, 0, 0]\n"
        "1773230880.0  2 0x23A Rx d 8 [0, 0, 0, 0, 0, 0, 0, 0]\n",
        encoding="utf-8",
    )
    catalog = {
        "0x2FC": MessageDefinition(
            msg_id="0x2FC",
            msg_name="Car_Status",
            bus_name="Car_CAN",
            signals=[],
        ),
        "0x23A": MessageDefinition(
            msg_id="0x23A",
            msg_name="Other",
            bus_name="Car_CAN",
            signals=[],
        ),
    }
    session = parse_log(log_file, catalog, "test-session")
    assert session.frame_count == 2
    assert session.start_ts == 1773230879.890181
    assert session.frames[0].msg_id == "0x2FC"


def test_unknown_msg_id_not_skipped(tmp_path: Path) -> None:
    """Frames with ids missing from catalog are kept with msg_name UNKNOWN."""
    log_file = tmp_path / "u.txt"
    log_file.write_text(
        "CAN 1: Car_CAN\n"
        "100.0  1 0xDEAD Rx d 8 [0, 0, 0, 0, 0, 0, 0, 0]\n",
        encoding="utf-8",
    )
    session = parse_log(log_file, {}, "s2")
    assert len(session.frames) == 1
    assert session.frames[0].msg_name == "UNKNOWN"
