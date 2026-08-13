"""
anomaly_engine.py — ML anomaly engine for KPIT Smart Real-Time CAN Analyser.

Replaces anomaly_scorer.py (docs/ANOMALY_REDESIGN_PLAN.md, Phase 4).

Key properties:

  * Per-message models keyed by catalog scope. Frames carry ``catalog_files``
    (the same per-car scoping the decoder uses); models for one catalog scope
    never see frames from another, so two car variants sharing message names
    can never cross-contaminate each other's baselines.

  * Deterministic, explainable detectors first:
      - Transition model per enum signal: the set of (from -> to) label
        transitions observed in clean sessions. A never-seen transition is an
        anomaly with both states named.
      - Inter-arrival model per message: a robust percentile band over the
        gaps observed in clean sessions. A gap far outside the band is an
        anomaly with the band named.

  * IsolationForest per message type behind the ``--ml`` flag. Features are
    the message's raw signal values plus the inter-arrival gap; the anomaly
    threshold is a low percentile of decision_function() on the baseline.

  * Baselines from clean sessions ONLY (no self-poisoning): frames accumulate
    into per-session candidates, and a candidate is merged into the persistent
    scope baseline only when the backend publishes a session-clean-events
    verdict saying the session finished with zero SPEC/REQUIREMENT findings.
    Until a scope has at least one committed clean session, the engine stays
    silent for it — no baseline, no findings.

  * Model files are versioned per catalog-scope hash (JSON, no pickle):
    ``models/anomaly_model_<scope>.json``.

Events are published to the anomaly-events topic; the backend maps them onto
the findings store with layer=ML and severity capped at LOW.

Usage:
    python anomaly_engine.py --kafka 127.0.0.1:9092
    python anomaly_engine.py --kafka 127.0.0.1:9092 --ml
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import signal as os_signal
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

try:
    from confluent_kafka import Consumer, Producer, KafkaError
    KAFKA_AVAILABLE = True
except ImportError:  # pure-model unit tests do not need Kafka
    KAFKA_AVAILABLE = False

try:
    from sklearn.ensemble import IsolationForest as _IsolationForest
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [anomaly_engine] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Topics / groups ───────────────────────────────────────────────────────────

INPUT_TOPIC = "decoded-signals"
CLEAN_TOPIC = "session-clean-events"
OUTPUT_TOPIC = "anomaly-events"
CONSUMER_GROUP = "anomaly-engine-group"

# ── Model parameters ──────────────────────────────────────────────────────────

# Minimum committed gap samples before the inter-arrival band is trusted.
MIN_GAP_SAMPLES = 30
# Robust band: [p01 * LO_MARGIN, p99 * HI_MARGIN] of committed gaps.
GAP_LO_MARGIN = 0.5
GAP_HI_MARGIN = 2.0
# Caps so model files stay small no matter how many sessions commit.
MAX_GAPS_KEPT = 5000
MAX_FEATURES_KEPT = 2000
# IsolationForest: minimum baseline rows before fitting; threshold percentile
# of decision_function() over the training rows (scores below it = anomalous).
IF_MIN_SAMPLES = 100
IF_THRESHOLD_PERCENTILE = 1.0

MODEL_FILE_VERSION = 1

EVENT_SIGNAL_TRANSITION = "SIGNAL_TRANSITION"
EVENT_INTER_ARRIVAL = "INTER_ARRIVAL"
EVENT_OUTLIER = "OUTLIER"


def scope_hash(catalog_files) -> str:
    """Stable short hash for a frame's catalog scope ('global' when unscoped)."""
    if not isinstance(catalog_files, list) or not catalog_files:
        return "global"
    normalized = sorted(str(f).strip().lower() for f in catalog_files if str(f).strip())
    if not normalized:
        return "global"
    return hashlib.sha1(",".join(normalized).encode("utf-8")).hexdigest()[:12]


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Percentile of an already-sorted list (nearest-rank, no numpy needed)."""
    if not sorted_values:
        return 0.0
    rank = max(0, min(len(sorted_values) - 1, int(round(pct / 100.0 * (len(sorted_values) - 1)))))
    return sorted_values[rank]


# ── Committed baseline (per scope, per message) ──────────────────────────────


@dataclass
class MessageBaseline:
    """What clean sessions have taught us about one message type."""

    transitions: dict = field(default_factory=dict)   # signal -> set[(from, to)]
    gaps: list = field(default_factory=list)          # inter-arrival seconds
    feature_names: list = field(default_factory=list) # signal order for IF rows
    features: list = field(default_factory=list)      # committed IF rows
    sessions: int = 0                                 # clean sessions merged

    def gap_band(self) -> Optional[tuple[float, float]]:
        """Robust (lo, hi) inter-arrival band, or None when data is too thin."""
        if len(self.gaps) < MIN_GAP_SAMPLES:
            return None
        ordered = sorted(self.gaps)
        lo = _percentile(ordered, 1.0) * GAP_LO_MARGIN
        hi = _percentile(ordered, 99.0) * GAP_HI_MARGIN
        return (lo, hi)

    def knows_transition(self, sig: str, prev: str, now: str) -> bool:
        return (prev, now) in self.transitions.get(sig, set())

    def merge_candidate(self, candidate: "MessageCandidate") -> None:
        for sig, pairs in candidate.transitions.items():
            self.transitions.setdefault(sig, set()).update(pairs)
        self.gaps.extend(candidate.gaps)
        if len(self.gaps) > MAX_GAPS_KEPT:
            self.gaps = self.gaps[-MAX_GAPS_KEPT:]
        if not self.feature_names and candidate.feature_names:
            self.feature_names = list(candidate.feature_names)
        if self.feature_names:
            for row in candidate.features_for(self.feature_names):
                self.features.append(row)
            if len(self.features) > MAX_FEATURES_KEPT:
                self.features = self.features[-MAX_FEATURES_KEPT:]
        self.sessions += 1

    def to_dict(self) -> dict:
        return {
            "transitions": {s: sorted(list(p) for p in pairs)
                            for s, pairs in self.transitions.items()},
            "gaps": self.gaps,
            "feature_names": self.feature_names,
            "features": self.features,
            "sessions": self.sessions,
        }

    @staticmethod
    def from_dict(data: dict) -> "MessageBaseline":
        baseline = MessageBaseline(
            gaps=list(data.get("gaps", [])),
            feature_names=list(data.get("feature_names", [])),
            features=[list(r) for r in data.get("features", [])],
            sessions=int(data.get("sessions", 0)),
        )
        for sig, pairs in (data.get("transitions") or {}).items():
            baseline.transitions[sig] = {(str(a), str(b)) for a, b in pairs}
        return baseline


@dataclass
class MessageCandidate:
    """One session's not-yet-trusted observations of a message type."""

    transitions: dict = field(default_factory=dict)   # signal -> set[(from, to)]
    gaps: list = field(default_factory=list)
    feature_names: list = field(default_factory=list)
    raw_rows: list = field(default_factory=list)      # list[dict signal->value + gap]

    def record_transition(self, sig: str, prev: str, now: str) -> None:
        self.transitions.setdefault(sig, set()).add((prev, now))

    def record_gap(self, gap: float) -> None:
        if 0.0 < gap and len(self.gaps) < MAX_GAPS_KEPT:
            self.gaps.append(gap)

    def record_row(self, values: dict, gap: float) -> None:
        if len(self.raw_rows) >= MAX_FEATURES_KEPT:
            return
        if not self.feature_names:
            self.feature_names = sorted(values.keys())
        row = dict(values)
        row["__gap__"] = gap
        self.raw_rows.append(row)

    def features_for(self, feature_names: list[str]) -> list[list[float]]:
        """Rows projected onto the baseline's signal order (missing -> 0)."""
        rows = []
        for raw in self.raw_rows:
            rows.append([float(raw.get(name, 0.0)) for name in feature_names]
                        + [float(raw.get("__gap__", 0.0))])
        return rows


class ScopeModel:
    """All committed baselines for one catalog scope + optional IF models."""

    def __init__(self, scope: str, catalog_files: Optional[list] = None) -> None:
        self.scope = scope
        self.catalog_files = catalog_files or []
        self.messages: dict[str, MessageBaseline] = {}
        # msg -> (fitted IsolationForest, threshold); rebuilt lazily.
        self._forests: dict[str, tuple[object, float]] = {}

    def baseline(self, msg: str) -> Optional[MessageBaseline]:
        found = self.messages.get(msg)
        return found if found is not None and found.sessions > 0 else None

    def commit_session(self, candidates: dict[str, MessageCandidate]) -> None:
        for msg, candidate in candidates.items():
            self.messages.setdefault(msg, MessageBaseline()).merge_candidate(candidate)
        self._forests.clear()  # refit lazily against the enlarged baseline

    # ── IsolationForest (optional) ────────────────────────────────────────────

    def forest_for(self, msg: str):
        """(model, threshold) for a message, fitting on demand; None if unfit."""
        if not SKLEARN_AVAILABLE:
            return None
        cached = self._forests.get(msg)
        if cached is not None:
            return cached
        baseline = self.baseline(msg)
        if baseline is None or len(baseline.features) < IF_MIN_SAMPLES:
            return None
        model = _IsolationForest(n_estimators=100, contamination="auto", random_state=42)
        model.fit(baseline.features)
        train_scores = sorted(float(s) for s in model.decision_function(baseline.features))
        threshold = _percentile(train_scores, IF_THRESHOLD_PERCENTILE)
        self._forests[msg] = (model, threshold)
        log.info("IsolationForest fitted: scope=%s msg=%s rows=%d threshold=%.4f",
                 self.scope, msg, len(baseline.features), threshold)
        return self._forests[msg]

    # ── Persistence (JSON — model files are user-inspectable, never pickle) ──

    def to_dict(self) -> dict:
        return {
            "version": MODEL_FILE_VERSION,
            "scope": self.scope,
            "catalog_files": self.catalog_files,
            "messages": {msg: b.to_dict() for msg, b in self.messages.items()},
        }

    @staticmethod
    def from_dict(data: dict) -> "ScopeModel":
        model = ScopeModel(str(data.get("scope", "global")), data.get("catalog_files") or [])
        for msg, raw in (data.get("messages") or {}).items():
            model.messages[msg] = MessageBaseline.from_dict(raw)
        return model


# ── Per-session tracking ─────────────────────────────────────────────────────


class SessionTracker:
    """Live state for one session: candidates + last values + event dedup."""

    def __init__(self, session_id: str, scope: str, catalog_files: list) -> None:
        self.session_id = session_id
        self.scope = scope
        self.catalog_files = catalog_files
        self.candidates: dict[str, MessageCandidate] = {}
        self.last_labels: dict[tuple[str, str], str] = {}   # (msg, signal) -> label
        self.last_ts: dict[str, float] = {}                 # msg -> frame ts
        self.emitted: set = set()                           # event dedup keys

    def candidate(self, msg: str) -> MessageCandidate:
        return self.candidates.setdefault(msg, MessageCandidate())

    def dedup(self, key: tuple) -> bool:
        """True the first time a key is seen (event should be emitted)."""
        if key in self.emitted:
            return False
        self.emitted.add(key)
        return True


# ── The engine (pure logic — Kafka I/O is injected by the service below) ─────


class AnomalyEngine:
    """Scope-keyed models + per-session candidates + detection."""

    def __init__(self, models_dir: str, ml_enabled: bool = False) -> None:
        self.models_dir = models_dir
        self.ml_enabled = ml_enabled and SKLEARN_AVAILABLE
        self.scopes: dict[str, ScopeModel] = {}
        self.sessions: dict[str, SessionTracker] = {}
        self._load_models()

    # ── Frame processing: returns the list of anomaly events to publish ──────

    def on_frame(self, frame: dict) -> list[dict]:
        session_id = str(frame.get("session_id") or "unknown")
        msg_name = str(frame.get("msg_name") or "UNKNOWN")
        ts = float(frame.get("timestamp") or time.time())
        catalog_files = frame.get("catalog_files") or []
        scope = scope_hash(catalog_files)

        tracker = self.sessions.get(session_id)
        if tracker is None:
            tracker = SessionTracker(session_id, scope, list(catalog_files))
            self.sessions[session_id] = tracker

        scope_model = self.scopes.setdefault(scope, ScopeModel(scope, list(catalog_files)))
        baseline = scope_model.baseline(msg_name)
        candidate = tracker.candidate(msg_name)

        labels, values = self._extract_signals(frame)
        events: list[dict] = []

        # 1 — transition model per enum signal
        for sig, now_label in labels.items():
            prev_label = tracker.last_labels.get((msg_name, sig))
            tracker.last_labels[(msg_name, sig)] = now_label
            if prev_label is None or prev_label == now_label:
                continue
            candidate.record_transition(sig, prev_label, now_label)
            if baseline is not None and not baseline.knows_transition(sig, prev_label, now_label):
                if tracker.dedup((EVENT_SIGNAL_TRANSITION, msg_name, sig, prev_label, now_label)):
                    events.append(self._event(
                        frame, scope, EVENT_SIGNAL_TRANSITION, "LOW",
                        f"Unspecified anomaly: never-seen transition {sig} "
                        f"{prev_label} → {now_label}",
                        {"signal": sig, "from": prev_label, "to": now_label,
                         "baselineSessions": baseline.sessions}))

        # 2 — inter-arrival model per message
        prev_ts = tracker.last_ts.get(msg_name)
        tracker.last_ts[msg_name] = ts
        gap = (ts - prev_ts) if prev_ts is not None else None
        if gap is not None and gap > 0:
            candidate.record_gap(gap)
            band = baseline.gap_band() if baseline is not None else None
            if band is not None and not (band[0] <= gap <= band[1]):
                kind = "fast" if gap < band[0] else "slow"
                if tracker.dedup((EVENT_INTER_ARRIVAL, msg_name, kind)):
                    events.append(self._event(
                        frame, scope, EVENT_INTER_ARRIVAL, "INFO",
                        f"Unspecified anomaly: {msg_name} inter-arrival "
                        f"{gap * 1000:.1f}ms outside baseline band "
                        f"[{band[0] * 1000:.1f}, {band[1] * 1000:.1f}]ms",
                        {"gapMs": round(gap * 1000, 3),
                         "bandLoMs": round(band[0] * 1000, 3),
                         "bandHiMs": round(band[1] * 1000, 3)}))

        # 3 — IsolationForest per message (behind the --ml flag)
        if values:
            candidate.record_row(values, gap or 0.0)
        if self.ml_enabled and baseline is not None and values:
            fitted = scope_model.forest_for(msg_name)
            if fitted is not None:
                model, threshold = fitted
                row = [float(values.get(name, 0.0)) for name in baseline.feature_names] \
                    + [float(gap or 0.0)]
                score = float(model.decision_function([row])[0])
                if score < threshold and tracker.dedup((EVENT_OUTLIER, msg_name)):
                    events.append(self._event(
                        frame, scope, EVENT_OUTLIER, "INFO",
                        f"Unspecified anomaly: {msg_name} feature vector is an "
                        f"outlier vs the clean baseline",
                        {"score": round(score, 6), "threshold": round(threshold, 6),
                         "features": baseline.feature_names + ["gap"]}))
        return events

    # ── Clean-session verdicts (from the backend) ────────────────────────────

    def on_session_verdict(self, session_id: str, clean: bool) -> None:
        """Merge the session's candidates into its scope baseline iff clean."""
        tracker = self.sessions.pop(session_id, None)
        if tracker is None:
            return
        if not clean:
            log.info("Session %s had findings — baseline candidates dropped", session_id[:8])
            return
        scope_model = self.scopes.setdefault(
            tracker.scope, ScopeModel(tracker.scope, tracker.catalog_files))
        scope_model.commit_session(tracker.candidates)
        self._save_model(scope_model)
        log.info("Session %s clean — %d message baseline(s) committed to scope %s",
                 session_id[:8], len(tracker.candidates), tracker.scope)

    # ── Internals ─────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_signals(frame: dict) -> tuple[dict, dict]:
        """(labels, numeric values) from a decoded frame's signals payload."""
        labels: dict[str, str] = {}
        values: dict[str, float] = {}
        signals = frame.get("signals") or {}
        for name, payload in signals.items():
            if isinstance(payload, dict):
                raw = payload.get("raw_value")
                label = payload.get("label")
                labels[name] = str(label) if label not in (None, "") else str(raw)
                if isinstance(raw, (int, float)):
                    values[name] = float(raw)
        if not labels:
            for name, raw in (frame.get("signals_flat") or {}).items():
                labels[name] = str(raw)
                if isinstance(raw, (int, float)):
                    values[name] = float(raw)
        return labels, values

    @staticmethod
    def _event(frame: dict, scope: str, event_type: str, severity: str,
               title: str, evidence: dict) -> dict:
        return {
            "session_id": str(frame.get("session_id") or "unknown"),
            "timestamp": frame.get("timestamp"),
            "msg_id": frame.get("msg_id", ""),
            "msg_name": frame.get("msg_name", "UNKNOWN"),
            "channel_name": frame.get("channel_name", ""),
            "scope": scope,
            "type": event_type,
            "severity": severity,
            "title": title,
            "evidence": evidence,
        }

    def _model_path(self, scope: str) -> str:
        return os.path.join(self.models_dir, f"anomaly_model_{scope}.json")

    def _save_model(self, model: ScopeModel) -> None:
        try:
            os.makedirs(self.models_dir, exist_ok=True)
            with open(self._model_path(model.scope), "w", encoding="utf-8") as handle:
                json.dump(model.to_dict(), handle)
        except OSError as exc:
            log.error("Could not persist model for scope %s: %s", model.scope, exc)

    def _load_models(self) -> None:
        if not os.path.isdir(self.models_dir):
            return
        for filename in os.listdir(self.models_dir):
            if not (filename.startswith("anomaly_model_") and filename.endswith(".json")):
                continue
            path = os.path.join(self.models_dir, filename)
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                if data.get("version") != MODEL_FILE_VERSION:
                    log.warning("Skipping %s: unsupported model version %s",
                                filename, data.get("version"))
                    continue
                model = ScopeModel.from_dict(data)
                self.scopes[model.scope] = model
                log.info("Loaded baseline for scope %s: %d message(s), from %s",
                         model.scope, len(model.messages), filename)
            except (OSError, ValueError) as exc:
                log.error("Could not load model file %s: %s", filename, exc)


# ── Kafka service wrapper ────────────────────────────────────────────────────


class AnomalyEngineService:
    """Consumes decoded-signals + session-clean-events, publishes anomaly-events."""

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.running = False
        self.frame_count = 0
        self.event_count = 0
        self.error_count = 0
        self.engine = AnomalyEngine(args.models_dir, ml_enabled=args.ml)

        if args.ml and not SKLEARN_AVAILABLE:
            log.warning("--ml requested but scikit-learn is not installed — "
                        "IsolationForest disabled, deterministic detectors stay active.")

        log.info("Connecting to Kafka: %s", args.kafka)
        self.consumer = Consumer({
            "bootstrap.servers": args.kafka,
            "group.id": args.group,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": False,
        })
        self.producer = Producer({
            "bootstrap.servers": args.kafka,
            "linger.ms": 1,
            "compression.type": "lz4",
        })

    def run(self) -> None:
        self.running = True
        os_signal.signal(os_signal.SIGINT, self._handle_stop)
        os_signal.signal(os_signal.SIGTERM, self._handle_stop)

        self.consumer.subscribe([INPUT_TOPIC, CLEAN_TOPIC])
        log.info("=== Anomaly Engine (Phase 4) ===")
        log.info("Kafka     : %s", self.args.kafka)
        log.info("Group     : %s", self.args.group)
        log.info("Inputs    : %s, %s", INPUT_TOPIC, CLEAN_TOPIC)
        log.info("Output    : %s", OUTPUT_TOPIC)
        log.info("Models dir: %s", self.args.models_dir)
        log.info("ML (IF)   : %s", "enabled" if self.engine.ml_enabled else "disabled")

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
                    self._dispatch(msg)
                    self.consumer.commit(msg)
                except Exception as exc:  # poison-message net, same policy as decoder.py
                    self.error_count += 1
                    self.consumer.commit(msg)
                    log.error("Unhandled error — message skipped: %s", exc)
        finally:
            self.consumer.close()
            self.producer.flush()
            log.info("Anomaly engine stopped — frames: %d, events: %d, errors: %d",
                     self.frame_count, self.event_count, self.error_count)

    def _dispatch(self, msg) -> None:
        payload = msg.value().decode("utf-8") if msg.value() else ""
        if not payload:
            return
        data = json.loads(payload)
        if msg.topic() == CLEAN_TOPIC:
            session_id = str(data.get("session_id") or "")
            if session_id:
                self.engine.on_session_verdict(session_id, bool(data.get("clean")))
            return

        self.frame_count += 1
        for event in self.engine.on_frame(data):
            self.event_count += 1
            self._publish(event)
        if self.frame_count % 1000 == 0:
            log.info("Processed %d frames | events: %d | live sessions: %d",
                     self.frame_count, self.event_count, len(self.engine.sessions))

    def _publish(self, event: dict) -> None:
        encoded = json.dumps(event).encode("utf-8")
        key = event["session_id"].encode("utf-8")
        try:
            self.producer.produce(OUTPUT_TOPIC, key=key, value=encoded,
                                  on_delivery=self._delivery_report)
        except BufferError:
            log.warning("Kafka local queue full — polling and retrying once")
            self.producer.poll(1)
            self.producer.produce(OUTPUT_TOPIC, key=key, value=encoded,
                                  on_delivery=self._delivery_report)
        self.producer.poll(0)
        log.warning("ANOMALY %s — session=%s msg=%s: %s",
                    event["type"], event["session_id"][:8], event["msg_name"], event["title"])

    @staticmethod
    def _delivery_report(err, msg) -> None:
        if err:
            log.error("Delivery failed for topic %s: %s", msg.topic(), err)

    def _handle_stop(self, signum, frame) -> None:
        log.info("Stop signal received — shutting down...")
        self.running = False


# ── CLI ──────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Anomaly engine — scoped explainable models over decoded-signals")
    parser.add_argument("--kafka", default="127.0.0.1:9092",
                        help="Kafka bootstrap servers (default: 127.0.0.1:9092)")
    parser.add_argument("--group", default=CONSUMER_GROUP,
                        help=f"Kafka consumer group ID (default: {CONSUMER_GROUP})")
    parser.add_argument("--ml", action="store_true",
                        help="Enable the per-message IsolationForest detector")
    parser.add_argument("--models-dir",
                        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"),
                        help="Directory for persisted per-scope model files")
    return parser.parse_args()


if __name__ == "__main__":
    if not KAFKA_AVAILABLE:
        log.error("confluent-kafka is required to run the engine service")
        sys.exit(1)
    AnomalyEngineService(parse_args()).run()
