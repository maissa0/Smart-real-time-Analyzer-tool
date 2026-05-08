"""Tests for xml_decoder bit patterns frame decoding."""

from models import MessageDefinition, SignalDefinition
from xml_decoder import _parse_bit_pattern, decode_frame


def test_parse_bit_pattern_rightmost_bits() -> None:
    """Low two bits set yields mask 0x03 and shift 0."""
    assert _parse_bit_pattern("xxxxxx11") == (0x03, 0)


def test_parse_bit_pattern_middle_bits() -> None:
    """Middle two bits yield mask 0x0C and shift 2."""
    assert _parse_bit_pattern("xxxx11xx") == (0x0C, 2)


def test_parse_bit_pattern_high_bits() -> None:
    """Top two bits yield mask 0xC0 and shift 6."""
    assert _parse_bit_pattern("11xxxxxx") == (0xC0, 6)


def test_parse_bit_pattern_wide() -> None:
    """Six low bits set yield mask 0x3F and shift 0."""
    assert _parse_bit_pattern("xx111111") == (0x3F, 0)


def test_decode_frame_door_latch() -> None:
    """Known mask and value map decode a door latch nibble from byte 0."""
    catalog = {
        "0x2FC": MessageDefinition(
            msg_id="0x2FC",
            msg_name="Car_Status",
            bus_name="Car_CAN",
            signals=[
                SignalDefinition(
                    byte_num=0,
                    signal_name="door_latche_status",
                    mask=0x0F,
                    shift=0,
                    value_map={"1": "Unlocked", "4": "Secured"},
                )
            ],
        )
    }
    out = decode_frame("0x2FC", [1, 0, 0, 0, 0, 0, 0, 0], catalog)
    assert len(out) == 1
    assert out[0].raw_value == 1
    assert out[0].label == "Unlocked"


def test_decode_frame_unknown_msg() -> None:
    """Missing message id returns an empty decode list."""
    assert decode_frame("0xDEAD", [0] * 8, {}) == []
