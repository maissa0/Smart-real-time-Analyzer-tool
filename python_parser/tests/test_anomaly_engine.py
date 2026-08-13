"""Unit tests for the Phase-4 anomaly engine (pure model logic, no Kafka).

Covers the plan's core guarantees:
  - silence before any clean baseline exists (no cold-start false positives),
  - never-seen transition detection with both states named,
  - inter-arrival band violations (+ per-session dedup),
  - catalog-scope isolation (one scope's baseline never judges another),
  - dirty sessions never poison the baseline,
  - JSON model persistence across engine restarts.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from anomaly_engine import (  # noqa: E402
    AnomalyEngine,
    EVENT_INTER_ARRIVAL,
    EVENT_SIGNAL_TRANSITION,
    scope_hash,
)


def make_frame(session, ts, msg="DOOR_STATUS", catalogs=("car1.xml",), **signals):
    """Synthetic decoded frame; signals kwargs are name=(raw_value, label)."""
    return {
        "session_id": session,
        "timestamp": ts,
        "msg_id": "0x1A0",
        "msg_name": msg,
        "channel_name": "Comfort_CAN",
        "catalog_files": list(catalogs),
        "signals": {
            name: {"raw_value": raw, "label": label}
            for name, (raw, label) in signals.items()
        },
    }


def commit_clean_baseline(engine, session="baseline", catalogs=("car1.xml",)):
    """Feed a clean session (green<->red every 100ms, 41 frames) and commit it."""
    labels = ["green", "red"]
    for i in range(41):
        label = labels[i % 2]
        events = engine.on_frame(make_frame(
            session, 100.0 + i * 0.1, catalogs=catalogs,
            Led=(i % 2, label)))
        assert events == []  # no baseline yet -> engine stays silent
    engine.on_session_verdict(session, clean=True)


def test_no_baseline_means_no_events(tmp_path):
    engine = AnomalyEngine(str(tmp_path))
    # Wild transitions and gaps, but no clean baseline exists for this scope.
    assert engine.on_frame(make_frame("s1", 10.0, Led=(1, "green"))) == []
    assert engine.on_frame(make_frame("s1", 99.0, Led=(7, "exploded"))) == []


def test_unseen_transition_is_reported_with_states_named(tmp_path):
    engine = AnomalyEngine(str(tmp_path))
    commit_clean_baseline(engine)

    assert engine.on_frame(make_frame("s2", 10.0, Led=(1, "green"))) == []
    events = engine.on_frame(make_frame("s2", 10.1, Led=(9, "off")))

    assert len(events) == 1
    event = events[0]
    assert event["type"] == EVENT_SIGNAL_TRANSITION
    assert event["severity"] == "LOW"
    assert event["evidence"]["from"] == "green"
    assert event["evidence"]["to"] == "off"
    assert "green" in event["title"] and "off" in event["title"]

    # Same unseen transition again in the same session -> deduplicated.
    engine.on_frame(make_frame("s2", 10.2, Led=(1, "green")))  # off->green also unseen
    repeat = engine.on_frame(make_frame("s2", 10.3, Led=(9, "off")))
    assert repeat == []


def test_known_transition_is_not_reported(tmp_path):
    engine = AnomalyEngine(str(tmp_path))
    commit_clean_baseline(engine)

    assert engine.on_frame(make_frame("s3", 10.0, Led=(1, "green"))) == []
    assert engine.on_frame(make_frame("s3", 10.1, Led=(0, "red"))) == []


def test_inter_arrival_outside_band_is_reported_once(tmp_path):
    engine = AnomalyEngine(str(tmp_path))
    commit_clean_baseline(engine)  # gaps ~100ms -> band roughly [50ms, 200ms]

    engine.on_frame(make_frame("s4", 10.0, Led=(1, "green")))
    engine.on_frame(make_frame("s4", 10.1, Led=(1, "green")))
    events = engine.on_frame(make_frame("s4", 11.1, Led=(1, "green")))  # 1s gap

    assert len(events) == 1
    event = events[0]
    assert event["type"] == EVENT_INTER_ARRIVAL
    assert event["severity"] == "INFO"
    assert event["evidence"]["gapMs"] == 1000.0
    assert event["evidence"]["bandHiMs"] < 1000.0

    # A second slow gap in the same session is deduplicated.
    assert engine.on_frame(make_frame("s4", 13.1, Led=(1, "green"))) == []


def test_catalog_scopes_are_isolated(tmp_path):
    engine = AnomalyEngine(str(tmp_path))
    commit_clean_baseline(engine, catalogs=("car1.xml",))

    # Same message name, different catalog scope: no baseline -> no events.
    other = ("car2.xml",)
    assert scope_hash(list(other)) != scope_hash(["car1.xml"])
    engine.on_frame(make_frame("s5", 10.0, catalogs=other, Led=(1, "green")))
    events = engine.on_frame(make_frame("s5", 10.1, catalogs=other, Led=(9, "off")))
    assert events == []


def test_dirty_session_never_becomes_baseline(tmp_path):
    engine = AnomalyEngine(str(tmp_path))
    labels = ["green", "red"]
    for i in range(41):
        engine.on_frame(make_frame("dirty", 100.0 + i * 0.1, Led=(i % 2, labels[i % 2])))
    engine.on_session_verdict("dirty", clean=False)

    # Still no baseline -> even a normal-looking transition raises nothing.
    engine.on_frame(make_frame("s6", 10.0, Led=(1, "green")))
    assert engine.on_frame(make_frame("s6", 10.1, Led=(0, "red"))) == []


def test_baseline_persists_across_restart(tmp_path):
    first = AnomalyEngine(str(tmp_path))
    commit_clean_baseline(first)

    reloaded = AnomalyEngine(str(tmp_path))  # fresh instance, same models dir
    reloaded.on_frame(make_frame("s7", 10.0, Led=(1, "green")))
    events = reloaded.on_frame(make_frame("s7", 10.1, Led=(9, "off")))

    assert len(events) == 1
    assert events[0]["type"] == EVENT_SIGNAL_TRANSITION
