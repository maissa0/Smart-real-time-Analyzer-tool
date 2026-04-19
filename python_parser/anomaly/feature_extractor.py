import numpy as np

KNOWN_FRAME_IDS = [0x2FC, 0x23A, 0x2AF, 0x2CA, 0x723]
KNOWN_CHANNELS = [1, 2]

EXPECTED_CYCLES_MS = {
    '0x2FC': 5000,
    '0x23A': 5000,
}

def extract_features(frame: dict, prev_frame_same_id: dict | None) -> np.ndarray:
    """
    Build a numeric feature vector from one decoded CAN frame.

    Features (8 total):
    0 - frame_id_normalized   : frame_id / 0xFFF
    1 - channel               : channel number (1 or 2)
    2 - byte0                 : raw byte 0 value / 255
    3 - byte1                 : raw byte 1 value / 255
    4 - byte2                 : raw byte 2 value / 255
    5 - time_since_last_ms    : ms since last frame with same ID (capped at 60000)
    6 - is_known_id           : 1.0 if frame_id in KNOWN_FRAME_IDS else 0.0
    7 - channel_mismatch      : 1.0 if frame arrived on unexpected channel else 0.0
    """
    frame_id_int = int(frame.get('frame_id', '0x0'), 16) \
        if isinstance(frame.get('frame_id'), str) \
        else int(frame.get('frame_id', 0))

    frame_id_hex = hex(frame_id_int)
    channel = int(frame.get('channel', 0))
    raw_bytes = frame.get('raw_bytes', [0, 0, 0, 0, 0, 0, 0, 0])
    if len(raw_bytes) < 3:
        raw_bytes = raw_bytes + [0] * (3 - len(raw_bytes))

    # Time delta
    if prev_frame_same_id is not None:
        delta_ms = (float(frame.get('timestamp', 0)) -
                    float(prev_frame_same_id.get('timestamp', 0))) * 1000
        delta_ms = min(abs(delta_ms), 60000)
    else:
        delta_ms = 0.0

    # Channel mismatch: 0x723 should only appear on channel 1 (Key_CAN)
    # 0x2FC, 0x23A, 0x2AF should only appear on channel 2 (Car_CAN)
    expected_channel = {0x723: 1, 0x2CA: 1}
    expected_ch = expected_channel.get(frame_id_int, 2)
    channel_mismatch = 1.0 if channel != expected_ch else 0.0

    is_known = 1.0 if frame_id_int in KNOWN_FRAME_IDS else 0.0

    return np.array([
        frame_id_int / 0xFFF,
        channel / 2.0,
        raw_bytes[0] / 255.0,
        raw_bytes[1] / 255.0,
        raw_bytes[2] / 255.0,
        delta_ms / 60000.0,
        is_known,
        channel_mismatch,
    ], dtype=np.float32)
