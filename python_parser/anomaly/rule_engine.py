"""
Layer 1 — Rule-based anomaly detection.
Uses knowledge already encoded in the XML config files.
Returns a list of alert dicts (empty if no anomaly detected).
"""

EXPECTED_CYCLES_MS = {
    '0x2FC': 5000,
    '0x23A': 5000,
}

CYCLE_TOLERANCE = 0.20   # 20% tolerance
FLOOD_THRESHOLD_MS = 200  # if same frame arrives faster than this → flooding

VALID_VALUES = {
    'door_latche_status':       [0, 1, 2, 3, 4, 6],
    'selective_unlock_status':  [0, 1],
    'Drd_Status':               [0, 1],
    'PSD_Status':               [0, 1],
    'DRDR_Status':              [0, 1],
    'Psdr_Status':              [0, 1],
    'Bootlid_Status':           [0, 1],
    'Rocker_switch_Status':     [0, 1, 2],
    'KEY_Pos':                  [0, 1, 2, 3],
    'KEY_Butt':                 [0, 1, 2, 3],
}

CHANNEL_MAP = {
    '0x723': 1,
    '0x2ca': 1,
    '0x2fc': 2,
    '0x23a': 2,
    '0x2af': 2,
}

def check(frame: dict, prev_frame_same_id: dict | None) -> list[dict]:
    alerts = []
    frame_id = frame.get('frame_id', '0x0')
    if isinstance(frame_id, int):
        frame_id = hex(frame_id)
    frame_id = frame_id.lower()
    timestamp = float(frame.get('timestamp', 0))
    channel = int(frame.get('channel', 0))

    # Rule 1 — flooding: same frame ID arriving too fast
    if prev_frame_same_id is not None:
        delta_ms = (timestamp -
            float(prev_frame_same_id.get('timestamp', 0))) * 1000
        if 0 < delta_ms < FLOOD_THRESHOLD_MS:
            alerts.append({
                'type': 'FLOODING',
                'severity': 'HIGH',
                'frame_id': frame_id,
                'detail': f'Frame arrived {delta_ms:.1f}ms after previous '
                          f'(threshold: {FLOOD_THRESHOLD_MS}ms)',
                'timestamp': timestamp,
            })

    # Rule 2 — message timeout: frame arrived much later than expected cycle
    if frame_id in EXPECTED_CYCLES_MS and prev_frame_same_id is not None:
        expected_ms = EXPECTED_CYCLES_MS[frame_id]
        delta_ms = (timestamp -
            float(prev_frame_same_id.get('timestamp', 0))) * 1000
        max_allowed = expected_ms * (1 + CYCLE_TOLERANCE)
        if delta_ms > max_allowed:
            alerts.append({
                'type': 'MESSAGE_TIMEOUT',
                'severity': 'MEDIUM',
                'frame_id': frame_id,
                'detail': f'Expected every {expected_ms}ms, '
                          f'arrived after {delta_ms:.0f}ms',
                'timestamp': timestamp,
            })

    # Rule 3 — wrong channel
    expected_ch = CHANNEL_MAP.get(frame_id)
    if expected_ch is not None and channel != expected_ch:
        alerts.append({
            'type': 'CHANNEL_VIOLATION',
            'severity': 'CRITICAL',
            'frame_id': frame_id,
            'detail': f'Frame {frame_id} appeared on channel {channel}, '
                      f'expected channel {expected_ch}',
            'timestamp': timestamp,
        })

    # Rule 4 — invalid signal value
    signals = frame.get('signals', {})
    if isinstance(signals, dict):
        for sig_name, sig_data in signals.items():
            if sig_name in VALID_VALUES:
                raw = None
                if isinstance(sig_data, dict):
                    raw = sig_data.get('raw_value')
                elif isinstance(sig_data, (int, float)):
                    raw = int(sig_data)
                if raw is not None and raw not in VALID_VALUES[sig_name]:
                    alerts.append({
                        'type': 'INVALID_SIGNAL_VALUE',
                        'severity': 'HIGH',
                        'frame_id': frame_id,
                        'signal': sig_name,
                        'detail': f'{sig_name} has invalid raw value {raw}',
                        'timestamp': timestamp,
                    })

    # Rule 5 — duplicate frame detection
    if prev_frame_same_id is not None:
        delta_ms = (timestamp - float(prev_frame_same_id.get('timestamp', 0))) * 1000
        if delta_ms < 1.0:
            prev_raw = prev_frame_same_id.get('raw_bytes', [])
            curr_raw = frame.get('raw_bytes', [])
            if prev_raw == curr_raw:
                alerts.append({
                    'type': 'DUPLICATE_FRAME',
                    'severity': 'MEDIUM',
                    'frame_id': frame_id,
                    'detail': f'Identical frame received {delta_ms:.3f}ms after previous',
                    'timestamp': timestamp,
                })

    return alerts
