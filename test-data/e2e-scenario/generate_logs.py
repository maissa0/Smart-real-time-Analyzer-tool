"""Deterministic generator (and verifier) for the E2E scenario session logs.

Produces three ASCII CAN logs replayable through the normal upload path
(POST /api/logs/upload -> file-processing-jobs -> file_worker.py):

    session_clean.log                  every rule passes, no findings
    session_requirement_violations.log deadline miss, forbidden edge,
                                       duration violation, illegal transition
    session_integrity_faults.log       unknown id, timing gap, out-of-range,
                                       duplicate frame

Log line format (mirrors python_parser/log_parser.py _LINE_RE):
      0.000000 1  0x500      Tx   d 8 [0, 1, 0, 0, 0, 0, 0, 0]

Usage:
    python generate_logs.py            # write the three logs next to this file
    python generate_logs.py --verify   # also parse them back through
                                       # python_parser and assert the scenario
                                       # (needs python_parser/.venv for defusedxml)
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BODY_CH = 1
CHASSIS_CH = 2

HEADER = "CAN 1: E2E_Body_CAN\nCAN 2: E2E_Chassis_CAN\n\n"

# Default signal state at t=0 for every log.
BASE_STATE = {
    "fl": 0, "fr": 0,          # door states (0=Closed 1=Opening 2=Open 3=Closing 4=Ajar)
    "lock": 1,                  # 0=Unlocked 1=Locked 2=Secure 3=Selective_Unlock
    "trunk": 0, "hood": 0,     # 0=Closed
    "win_fl": 0, "win_fr": 0, "win_motion": 0,
    "wiper": 0, "rain": 0,     # wiper 0=Off; rain 0=No_Rain 1=Raining
    "btn": 0,                   # E2E_Lock_Request 0=None 1=Lock 2=Unlock 3=Trunk_Release
    "speed": 0, "steer": 128, "gear": 0,
    "brake": 0,
}

# msg key -> (channel, can id, encoder)
ENCODERS = {
    "0x500": (BODY_CH, 0x500, lambda s: [s["fl"] | (s["fr"] << 3),
                                          s["lock"] | (s["trunk"] << 2) | (s["hood"] << 5),
                                          0, 0, 0, 0, 0, 0]),
    "0x501": (BODY_CH, 0x501, lambda s: [s["win_fl"], s["win_fr"], s["win_motion"],
                                          0, 0, 0, 0, 0]),
    "0x502": (BODY_CH, 0x502, lambda s: [s["wiper"] | (s["rain"] << 4),
                                          0, 0, 0, 0, 0, 0, 0]),
    "0x503": (BODY_CH, 0x503, lambda s: [s["btn"], 0, 0, 0, 0, 0, 0, 0]),
    "0x600": (CHASSIS_CH, 0x600, lambda s: [s["speed"]] * 4 + [0] * 4),
    "0x601": (CHASSIS_CH, 0x601, lambda s: [s["speed"], s["steer"], s["gear"],
                                             0, 0, 0, 0, 0]),
    "0x602": (CHASSIS_CH, 0x602, lambda s: [s["brake"], 0, 0, 0, 0, 0, 0, 0]),
}

# Periodic emission cadence: (msg key, first emission, period).
# Cadence is intentionally faster than 3x the catalog cycle time so the
# integrity TIMING_GAP check stays quiet unless a gap is crafted on purpose.
PERIODICS = [
    ("0x600", 0.00, 0.2),   # catalog cycle 100 ms -> max allowed gap 0.3 s
    ("0x601", 0.05, 0.2),   # catalog cycle 100 ms
    ("0x502", 0.10, 0.4),   # catalog cycle 200 ms -> max 0.6 s
    ("0x500", 0.15, 1.0),   # catalog cycle 500 ms -> max 1.5 s
    ("0x501", 0.20, 2.0),   # catalog cycle 1000 ms -> max 3.0 s
]


def fmt_line(t: float, ch: int, can_id: int, data: list[int]) -> str:
    payload = ", ".join(str(b) for b in data)
    return f"{t:10.6f} {ch}  0x{can_id:03X}      Tx   d 8 [{payload}]"


def clamp_byte(v: float) -> int:
    return max(0, min(255, int(round(v))))


def build_log(duration: float,
              events: list[tuple[float, dict, str | None]],
              cont: dict | None = None,
              exclusions: dict | None = None,
              extra_lines: list[tuple[float, int, int, list[int]]] | None = None) -> str:
    """Emit periodic frames + event frames, applying state changes in time order.

    events:      (t, state-updates, msg key to emit immediately or None)
    cont:        signal -> f(t) continuous overrides (speed, steering, windows)
    exclusions:  msg key -> list of (lo, hi) periodic-emission blackout windows
    extra_lines: raw frames appended verbatim (unknown ids, crafted duplicates)
    """
    cont = cont or {}
    exclusions = exclusions or {}
    emissions: list[tuple[float, str]] = []
    for key, first, period in PERIODICS:
        t = first
        while t <= duration + 1e-9:
            skip = any(lo < t < hi for lo, hi in exclusions.get(key, []))
            if not skip:
                emissions.append((round(t, 6), key))
            t = round(t + period, 6)
    for t, _updates, emit in events:
        if emit is not None:
            emissions.append((round(t, 6), emit))
    emissions.sort(key=lambda e: (e[0], e[1]))

    state = dict(BASE_STATE)
    ordered_events = sorted(events, key=lambda e: e[0])
    ev_idx = 0
    lines: list[tuple[float, str]] = []
    for t, key in emissions:
        while ev_idx < len(ordered_events) and ordered_events[ev_idx][0] <= t + 1e-9:
            state.update(ordered_events[ev_idx][1])
            ev_idx += 1
        snap = dict(state)
        for sig, fn in cont.items():
            snap[sig] = clamp_byte(fn(t))
        ch, can_id, enc = ENCODERS[key]
        lines.append((t, fmt_line(t, ch, can_id, enc(snap))))

    for t, ch, can_id, data in (extra_lines or []):
        lines.append((round(t, 6), fmt_line(t, ch, can_id, data)))

    lines.sort(key=lambda x: x[0])
    return HEADER + "\n".join(text for _t, text in lines) + "\n"


# ── Speed profiles (km/h, byte-encoded 1:1) ──────────────────────────────────

def speed_clean(t: float) -> float:
    if t < 10.05:
        return 0
    if t < 11.30:
        return min(60.0, (t - 10.05) / 1.25 * 60)
    if t < 16.00:
        return 60
    if t < 17.50:
        return max(0.0, 60 - (t - 16.00) / 1.5 * 60)
    return 0


def speed_violations(t: float) -> float:
    if t < 15.05:
        return 0
    if t < 16.30:
        return min(60.0, (t - 15.05) / 1.25 * 60)
    if t < 27.00:
        return 60
    if t < 28.50:
        return max(0.0, 60 - (t - 27.00) / 1.5 * 60)
    return 0


def steer_clean(t: float) -> float:
    if t < 11.0:
        return 128
    if t < 12.5:
        return 100
    if t < 14.0:
        return 150
    return 128


def steer_violations(t: float) -> float:
    if t < 17.0:
        return 128
    if t < 19.0:
        return 110
    if t < 21.0:
        return 145
    return 128


def window_fl_clean(t: float) -> float:
    if t < 6.0:
        return 0
    if t < 8.0:
        return 30
    if t < 10.0:
        return 60
    if t < 12.0:
        return 30
    return 0


def window_motion_clean(t: float) -> float:
    if 6.0 <= t < 10.0:
        return 2      # Moving_Down (opening)
    if 10.0 <= t < 14.0:
        return 1      # Moving_Up (closing)
    return 0


# ── Twin demo profiles (windows in % open, speed km/h, steering offset byte) ─

def window_fl_twin(t: float) -> float:
    if t < 8.0:
        return 0
    if t < 10.0:
        return 40
    if t < 11.5:
        return 80
    if t < 13.0:
        return 40
    return 0


def window_fr_twin(t: float) -> float:
    if t < 8.5:
        return 0
    if t < 10.5:
        return 50
    if t < 12.0:
        return 90
    if t < 13.5:
        return 45
    return 0


def window_motion_twin(t: float) -> float:
    if 8.0 <= t < 11.5:
        return 2      # Moving_Down (opening)
    if 11.5 <= t < 14.0:
        return 1      # Moving_Up (closing)
    return 0


def speed_twin(t: float) -> float:
    if t < 17.6:
        return 0
    if t < 19.5:
        return min(70.0, (t - 17.6) / 1.9 * 70)
    if t < 24.0:
        return 70
    if t < 25.5:
        return max(0.0, 70 - (t - 24.0) / 1.5 * 70)
    return 0


def steer_twin(t: float) -> float:
    if t < 19.0:
        return 128
    if t < 20.5:
        return 100    # left
    if t < 22.0:
        return 160    # right
    return 128


# ── The scenarios ────────────────────────────────────────────────────────────

def clean_log() -> str:
    events = [
        (0.50, {"btn": 0}, "0x503"),    # baseline so later presses are edges
        (0.60, {"brake": 0}, "0x602"),
        (2.02, {"lock": 0}, "0x500"),   # unlock (stationary -> E2E_A1 quiet)
        (3.01, {"btn": 1}, "0x503"),    # Lock_Pressed  -> E2E_R1 trigger
        (3.32, {"lock": 1}, "0x500"),   # locked 310 ms later -> R1 PASS, D1 PASS
        (3.61, {"btn": 0}, "0x503"),
        (5.02, {"fl": 1}, "0x500"),     # Closed -> Opening   (E2E_I1 pass)
        (5.53, {"fl": 2}, "0x500"),     # Opening -> Open     (pass)
        (7.03, {"fl": 3}, "0x500"),     # Open -> Closing     (pass)
        (7.54, {"fl": 0}, "0x500"),     # Closing -> Closed   (pass)
        (9.85, {"gear": 3}, None),      # Drive (rides the next 0x601 tick)
        (16.55, {"brake": 1}, "0x602"),
        (17.15, {"brake": 0}, "0x602"),
        (18.05, {"gear": 0}, None),     # Park
    ]
    cont = {
        "speed": speed_clean,
        "steer": steer_clean,
        "win_fl": window_fl_clean,
        "win_motion": window_motion_clean,
    }
    return build_log(20.0, events, cont)


def violations_log() -> str:
    events = [
        (0.50, {"btn": 0}, "0x503"),
        (0.60, {"brake": 0}, "0x602"),
        # E2E_D1 duration violation: unlocked (doors closed) for > 5 s
        (2.02, {"lock": 0}, "0x500"),
        # E2E_R1 TIMING_VIOLATED: press at 9.01, locked at 10.31 (1300 ms > 500)
        (9.01, {"btn": 1}, "0x503"),
        (10.31, {"lock": 1}, "0x500"),
        (10.61, {"btn": 0}, "0x503"),
        # E2E_R1 VIOLATED: press at 13.01, no lock before the 13.51 deadline
        (12.02, {"lock": 0}, "0x500"),
        (13.01, {"btn": 1}, "0x503"),
        (14.32, {"lock": 1}, "0x500"),  # too late; also counts an E2E_D1 pass
        (14.61, {"btn": 0}, "0x503"),
        (14.85, {"gear": 3}, None),
        # E2E_A1 forbidden edge: unlock while driving at 60 km/h
        (18.03, {"lock": 0}, "0x500"),
        (19.04, {"lock": 1}, "0x500"),
        # E2E_I2 violation: trunk opens while moving (clustered with E2E_I1)
        (20.03, {"trunk": 1}, "0x500"),
        # E2E_I1 illegal transition: door jumps Closed -> Open (skips Opening)
        (20.53, {"fl": 2}, "0x500"),
        (20.54, {"trunk": 2}, "0x500"),
        (21.04, {"fl": 3}, "0x500"),    # Open -> Closing (legal, pass)
        (21.55, {"trunk": 3}, "0x500"),
        (21.56, {"fl": 0}, "0x500"),    # Closing -> Closed (legal, pass)
        (22.06, {"trunk": 0}, "0x500"),
        # E2E_A2: wipers switch off while raining
        (23.44, {"rain": 1}, "0x502"),
        (23.83, {"wiper": 3}, "0x502"),
        (24.43, {"wiper": 0}, "0x502"),
        (25.23, {"rain": 0}, "0x502"),
        # Draft rule E2E_DR1: trunk release never opens the trunk -> silent
        (26.01, {"btn": 3}, "0x503"),
        (26.31, {"btn": 0}, "0x503"),
        (29.05, {"gear": 0}, None),
    ]
    cont = {"speed": speed_violations, "steer": steer_violations}
    return build_log(30.0, events, cont)


def integrity_log() -> str:
    events = [
        (0.50, {"btn": 0}, "0x503"),
        # SIGNAL_RANGE: gear 7 is outside the {0..4} enum, held for 3 ticks
        (6.05, {"gear": 7}, None),
        (6.65, {"gear": 0}, None),
        # DUPLICATE: identical Door_Status frame 0.5 ms after the 8.15 tick
        (8.1505, {}, "0x500"),
    ]
    # TIMING_GAP: Wheel_Speeds silent 4.0 -> 5.2 (1.2 s > 3 x 100 ms)
    exclusions = {"0x600": [(4.0, 5.2)]}
    # Unknown message id 0x6FF: decoded as UNKNOWN (not in any catalog)
    unknown = [(t, CHASSIS_CH, 0x6FF, [222, 173, 190, 239, 0, 0, 0, 0])
               for t in (1.5, 4.5, 7.5, 10.5)]
    return build_log(12.0, events, cont=None,
                     exclusions=exclusions, extra_lines=unknown)


def twin_demo_log() -> str:
    """3D-twin showcase: doors, hood, trunk, windows, wipers, wheels, steering
    and all three electronic-key zones — while every requirement stays PASS
    and the integrity checks stay quiet (D1's unlocked+door-closed spans are
    kept under 5 s; nothing opens while the car is moving)."""
    events = [
        (0.50, {"btn": 0}, "0x503"),
        (0.60, {"brake": 0}, "0x602"),
        # Key: Unlock pressed -> key appears on the podium ("outside")
        (2.00, {"btn": 2}, "0x503"),
        (2.30, {"lock": 0}, "0x500"),
        (2.60, {"btn": 0}, "0x503"),
        # Doors FL then FR: Closed -> Opening -> Open (legal transitions)
        (4.02, {"fl": 1}, "0x500"),
        (4.53, {"fl": 2}, "0x500"),
        (5.02, {"fr": 1}, "0x500"),
        (5.53, {"fr": 2}, "0x500"),
        # Hood + trunk open (car stationary, so E2E_I2 stays quiet)
        (6.52, {"hood": 1}, "0x500"),
        (7.02, {"trunk": 1}, "0x500"),
        (7.53, {"trunk": 2}, "0x500"),
        # Rain -> wipers Low then High (never off while raining: E2E_A2 quiet)
        (9.02, {"rain": 1}, "0x502"),
        (9.42, {"wiper": 2}, "0x502"),
        (12.62, {"wiper": 3}, "0x502"),
        # Close everything before driving
        (13.02, {"trunk": 3}, "0x500"),
        (13.53, {"trunk": 0}, "0x500"),
        (14.02, {"hood": 0}, "0x500"),
        (14.52, {"fl": 3}, "0x500"),
        (15.03, {"fl": 0}, "0x500"),
        (15.52, {"fr": 3}, "0x500"),
        (16.03, {"fr": 0}, "0x500"),
        # Central locking (E2E_R1 PASS: locked 300 ms later; key -> "unknown")
        (16.53, {"btn": 1}, "0x503"),
        (16.83, {"lock": 1}, "0x500"),
        (17.13, {"btn": 0}, "0x503"),
        # Drive (key -> "inside"); speed/steering profiles spin the wheels
        (17.55, {"gear": 3}, None),
        # Rain stops, then wipers off (order keeps E2E_A2 quiet)
        (21.02, {"rain": 0}, "0x502"),
        (21.42, {"wiper": 0}, "0x502"),
        # Brake tap while slowing down
        (24.05, {"brake": 1}, "0x602"),
        (25.05, {"brake": 0}, "0x602"),
        (26.05, {"gear": 0}, None),     # Park — the key stays inside
    ]
    cont = {
        "speed": speed_twin,
        "steer": steer_twin,
        "win_fl": window_fl_twin,
        "win_fr": window_fr_twin,
        "win_motion": window_motion_twin,
    }
    return build_log(30.0, events, cont)


LOGS = {
    "session_clean.log": clean_log,
    "session_requirement_violations.log": violations_log,
    "session_integrity_faults.log": integrity_log,
    "session_twin_demo.log": twin_demo_log,
}


def generate() -> None:
    for name, builder in LOGS.items():
        path = HERE / name
        path.write_text(builder(), encoding="utf-8", newline="\n")
        line_count = sum(1 for _ in path.open(encoding="utf-8"))
        print(f"wrote {name}  ({line_count} lines)")


# ── Verification: parse the logs back through python_parser ──────────────────

def verify() -> None:
    sys.path.insert(0, str(HERE.parents[1] / "python_parser"))
    from xml_decoder import load_catalog          # noqa: E402
    from log_parser import parse_log              # noqa: E402

    catalog = load_catalog(HERE)
    assert sorted(catalog.keys()) == [
        "0x500", "0x501", "0x502", "0x503", "0x600", "0x601", "0x602",
    ], f"catalog keys wrong: {sorted(catalog.keys())}"
    cycles = {m.msg_name: m.cycle_ms for m in catalog.values()}
    assert cycles == {
        "Door_Status": 500, "Window_Status": 1000, "Wiper_Rain_Status": 200,
        "Body_Command": None, "Wheel_Speeds": 100, "Vehicle_Dynamics": 100,
        "Brake_Event": None,
    }, f"cycle times wrong: {cycles}"

    valid_sets = {
        sig.signal_name: {int(v) for v in sig.value_map}
        for m in catalog.values() for sig in m.signals if sig.value_map
    }

    def timeline(frames, signal):
        """[(ts, raw, label)] for every frame carrying the signal."""
        out = []
        for f in frames:
            for s in f.signals:
                if s.signal_name == signal:
                    out.append((f.timestamp, s.raw_value, s.label))
        return out

    def changes(frames, signal):
        """[(ts, prev_label, new_label)] on value change (first sighting skipped)."""
        out, prev = [], None
        for ts, _raw, label in timeline(frames, signal):
            if prev is not None and label != prev:
                out.append((ts, prev, label))
            prev = label
        return out

    def value_at(frames, signal, ts):
        last = None
        for t, _raw, label in timeline(frames, signal):
            if t > ts + 1e-9:
                break
            last = label
        return last

    def raw_at(frames, signal, ts):
        last = None
        for t, raw, _label in timeline(frames, signal):
            if t > ts + 1e-9:
                break
            last = raw
        return last

    def integrity_recheck(frames):
        """Recompute DUPLICATE / TIMING_GAP / SIGNAL_RANGE like the analyzer."""
        gaps, dups, range_faults = [], [], []
        last: dict[str, tuple[float, tuple]] = {}
        for f in frames:
            key = f.msg_name
            payload = tuple(f.raw_bytes)
            if key in last:
                gap = f.timestamp - last[key][0]
                cycle = next((m.cycle_ms for m in catalog.values()
                              if m.msg_name == key), None)
                if cycle is not None and gap > 3 * cycle / 1000.0:
                    gaps.append((key, round(gap, 3), f.timestamp))
                if gap < 0.001 and payload == last[key][1]:
                    dups.append((key, f.timestamp))
            last[key] = (f.timestamp, payload)
            for s in f.signals:
                allowed = valid_sets.get(s.signal_name)
                if allowed and s.raw_value not in allowed:
                    range_faults.append((s.signal_name, s.raw_value, f.timestamp))
        return gaps, dups, range_faults

    sessions = {name: parse_log(HERE / name, catalog, session_id=name)
                for name in LOGS}

    # ── session_clean ────────────────────────────────────────────────────────
    fr = sessions["session_clean.log"].frames
    assert all(f.msg_name != "UNKNOWN" for f in fr), "clean log has UNKNOWN frames"
    gaps, dups, ranges = integrity_recheck(fr)
    assert not gaps and not dups and not ranges, (gaps, dups, ranges)

    presses = [c for c in changes(fr, "E2E_Lock_Request") if c[2] == "Lock_Pressed"]
    locks = [c for c in changes(fr, "E2E_Door_Lock_State") if c[2] == "Locked"]
    assert len(presses) == 1 and len(locks) == 1
    latency = locks[0][0] - presses[0][0]
    assert 0 < latency <= 0.5, f"R1 latency {latency}"           # R1 PASS
    unlocked_at = [c[0] for c in changes(fr, "E2E_Door_Lock_State")
                   if c[2] == "Unlocked"]
    assert len(unlocked_at) == 1
    assert locks[0][0] - unlocked_at[0] < 5.0                     # D1 PASS
    door = changes(fr, "E2E_Door_FL_State")
    assert [(c[1], c[2]) for c in door] == [
        ("Closed", "Opening"), ("Opening", "Open"),
        ("Open", "Closing"), ("Closing", "Closed")]               # I1 4x PASS
    for ts, _p, new in changes(fr, "E2E_Door_Lock_State"):
        if new == "Unlocked":
            spd = raw_at(fr, "E2E_Vehicle_Speed", ts - 0.01)
            assert spd is not None and spd <= 5, \
                "unlock while moving in clean log"                       # A1 quiet
    for ts, raw, _l in timeline(fr, "E2E_Trunk_State"):
        if (raw_at(fr, "E2E_Vehicle_Speed", ts) or 0) > 5:
            assert raw == 0, "trunk open while moving in clean log"      # I2 PASS
    assert all(label == "No_Rain" for _t, _r, label
               in timeline(fr, "E2E_Rain_Detected"))                     # A2 quiet
    print("session_clean.log                  OK "
          f"({len(fr)} frames, R1 latency {int(latency * 1000)} ms)")

    # ── session_requirement_violations ───────────────────────────────────────
    fr = sessions["session_requirement_violations.log"].frames
    assert all(f.msg_name != "UNKNOWN" for f in fr)
    gaps, dups, ranges = integrity_recheck(fr)
    assert not gaps and not dups and not ranges, (gaps, dups, ranges)

    presses = [c[0] for c in changes(fr, "E2E_Lock_Request")
               if c[2] == "Lock_Pressed"]
    locks = [c[0] for c in changes(fr, "E2E_Door_Lock_State") if c[2] == "Locked"]
    assert len(presses) == 2
    lat1 = min(t for t in locks if t > presses[0]) - presses[0]
    assert lat1 > 0.5, f"press 1 latency {lat1} should miss the deadline"  # TIMING
    lock_after_2 = min(t for t in locks if t > presses[1])
    assert lock_after_2 - presses[1] > 0.5                                  # VIOLATED
    assert any(f.timestamp > presses[1] + 0.5 and f.timestamp < lock_after_2
               for f in fr), "no frame advances time past press-2 deadline"
    unlocks = [c[0] for c in changes(fr, "E2E_Door_Lock_State")
               if c[2] == "Unlocked"]
    first_relock = min(t for t in locks if t > unlocks[0])
    assert first_relock - unlocks[0] > 5.0                                  # D1
    a1 = [t for t in unlocks
          if (raw_at(fr, "E2E_Vehicle_Speed", t - 0.01) or 0) > 5]
    assert len(a1) == 1, f"expected exactly one unlock while moving: {a1}"  # A1
    door = changes(fr, "E2E_Door_FL_State")
    allowed = {("Closed", "Opening"), ("Opening", "Open"), ("Open", "Closing"),
               ("Closing", "Closed"), ("Closed", "Ajar"), ("Ajar", "Closed")}
    illegal = [c for c in door if (c[1], c[2]) not in allowed]
    assert [(c[1], c[2]) for c in illegal] == [("Closed", "Open")]          # I1
    trunk_open_moving = [ts for ts, raw, _ in timeline(fr, "E2E_Trunk_State")
                         if raw != 0 and
                         (raw_at(fr, "E2E_Vehicle_Speed", ts) or 0) > 5]
    assert trunk_open_moving, "trunk never open while moving"               # I2
    assert abs(illegal[0][0] - min(trunk_open_moving)) < 2.0, \
        "I1/I2 not within the 2 s cluster window"
    wiper_off = [c for c in changes(fr, "E2E_Wiper_Mode") if c[2] == "Off"]
    a2 = [c for c in wiper_off
          if value_at(fr, "E2E_Rain_Detected", c[0] - 0.01) == "Raining"]
    assert len(a2) == 1                                                     # A2
    releases = [c for c in changes(fr, "E2E_Lock_Request")
                if c[2] == "Trunk_Release"]
    assert len(releases) == 1
    assert all(raw == 0 for ts, raw, _ in timeline(fr, "E2E_Trunk_State")
               if ts > releases[0][0]), "trunk must stay closed after release"  # DR1
    print(f"session_requirement_violations.log OK ({len(fr)} frames, "
          f"press-1 latency {int(lat1 * 1000)} ms)")

    # ── session_integrity_faults ─────────────────────────────────────────────
    fr = sessions["session_integrity_faults.log"].frames
    unknown = [f for f in fr if f.msg_name == "UNKNOWN"]
    assert len(unknown) == 4 and all(f.msg_id == "0x6FF" for f in unknown)
    gaps, dups, ranges = integrity_recheck(fr)
    assert [(g[0], g[1]) for g in gaps] == [("Wheel_Speeds", 1.2)], gaps
    assert len(dups) == 1 and dups[0][0] == "Door_Status", dups
    assert (len(ranges) == 3 and
            all(r[0] == "E2E_Gear_Position" and r[1] == 7 for r in ranges)), ranges
    assert not changes(fr, "E2E_Door_Lock_State")
    assert not changes(fr, "E2E_Door_FL_State")
    assert not [c for c in changes(fr, "E2E_Lock_Request")]
    assert all(label == "No_Rain" for _t, _r, label
               in timeline(fr, "E2E_Rain_Detected"))
    assert all(raw == 0 for _t, raw, _l in timeline(fr, "E2E_Vehicle_Speed"))
    print(f"session_integrity_faults.log       OK ({len(fr)} frames, "
          "gap/dup/range/unknown all as designed)")

    print("\nAll verification checks passed.")


if __name__ == "__main__":
    generate()
    if "--verify" in sys.argv:
        verify()
