"""Core dataclasses for CAN catalog definitions and decoded log data."""

from dataclasses import dataclass, field


@dataclass
class SignalDefinition:
    """One signal derived from a catalog XML entry (bit mask and enumerated values)."""

    byte_num: int
    signal_name: str
    mask: int
    shift: int
    value_map: dict[str, str]


@dataclass
class MessageDefinition:
    """One CAN message (frame) definition with its signal layout for a bus."""

    msg_id: str
    msg_name: str
    bus_name: str
    signals: list[SignalDefinition] = field(default_factory=list)


@dataclass
class DecodedSignal:
    """A single decoded signal value extracted from one received frame."""

    signal_name: str
    raw_value: int
    label: str


@dataclass
class DecodedFrame:
    """One CAN frame with optional decoded signals and channel metadata."""

    timestamp: float
    channel: int
    channel_name: str
    msg_id: str
    msg_name: str
    raw_bytes: list[int]
    signals: list[DecodedSignal] = field(default_factory=list)
    direction: str = "Rx"


@dataclass
class ParsedSession:
    """Complete result of parsing one log file into timestamped decoded frames."""

    session_id: str
    source_filename: str
    start_ts: float
    end_ts: float
    frame_count: int
    frames: list[DecodedFrame] = field(default_factory=list)
