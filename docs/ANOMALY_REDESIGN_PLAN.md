# Anomaly & Fault Detection Redesign — Implementation Plan

> Supersedes the ML-only plan in `ANOMALY_DETECTION.md` for overall architecture.
> Goal: hybrid detection — deterministic spec checks + requirements-based behavioral
> rules + ML for unspecified anomalies — feeding one findings pipeline with
> user-facing guidance.
>
> **Core constraint: everything is dynamic and per-car.** Catalogs AND requirement
> files are user-uploaded artifacts assigned to a specific car (`car_catalogs`
> join table pattern). Detection for a session must use exactly the files assigned
> to that session's car — never a global merged view.

---

## Phase 0 — Fix the existing detection layer (prerequisite)

The integrity analyzer becomes the foundation of Layer 1 and the requirements
engine will share its execution path, so its concurrency model must be fixed first.

### 0.1 Serialize per-session analysis (fixes ordering race)
- **Problem**: `CanKafkaConsumer` dispatches `integrityAnalyzerService.analyze()`
  via `CompletableFuture.runAsync` per frame → same-message frames analyzed
  concurrently/out of order → false DUPLICATE/TIMING_GAP/COUNTER_ERROR faults.
- **Fix**: introduce `AnalysisExecutorService` — a pool of single-threaded
  executors, frame routed by `hash(sessionId) % N` (N ≈ 4). All sequential
  analysis (integrity + requirements engine later) for one session runs on one
  thread, in Kafka order. Influx writes can stay on the common pool.
- Files: `CanKafkaConsumer.java`, new `AnalysisExecutorService.java`.
- Test: unit test feeding out-of-order timestamps through two sessions
  concurrently; assert no spurious faults.

### 0.2 Sequence regression detection
- `COUNTER_ERROR` currently only fires on `seq > prev+1`. Add
  `SEQUENCE_REGRESSION` fault when `seq <= prev` (replay/reset signature),
  keeping `lastSeq = max(prev, seq)`.

### 0.3 Dead-message sweeper
- New scheduled task (every 500 ms) in `IntegrityAnalyzerService`: for each
  active session key with a cyclic message whose
  `now - lastTimestamp > cycle × GAP_MULTIPLIER`, raise `MESSAGE_TIMEOUT`
  once (latched until the message resumes). This finally catches "ECU went
  silent", which frame-driven checks structurally cannot.
- Needs a wall-clock ↔ frame-clock mapping: track `lastArrivalNanos` alongside
  frame timestamps; sweep on arrival clock.

### 0.4 Fault dedup / flood control
- Add `occurrences` + `lastSeenTs` columns to `IntegrityFaultEntity`
  (migration in `db/`). Dedup key: `sessionId + msgName + faultType + signalName`.
  Repeated identical faults within a session update `occurrences`/`lastSeenTs`
  instead of inserting rows. In-memory LRU of recent fault keys per session,
  cleared in `clearSession()`.

### 0.5 Anomaly scorer stopgaps (cheap, before Phase 4 replaces it)
- Threshold on `decision_function()` (< 0 = anomaly), not `score_samples() < -0.10`.
- Cold-start: flag at `z > COLD_START_SIGMA` directly; drop the `-(z/6)` mapping.
- Bound `_training_buffer` even when sklearn is missing.
- Fix misleading "offset NOT committed" log (offsets are always committed).

**Acceptance for Phase 0**: existing pytest + new Java unit tests green; replay
of a known log produces a stable, deduplicated fault list identical across runs.

---

## Phase 1 — Requirements as dynamic per-car files

### 1.1 Rule schema (YAML)
One file = one requirement set (e.g. `comfort_can_requirements.yaml`). Schema:

```yaml
meta:
  name: Comfort CAN access requirements
  version: 1
  signal_map:              # rule name -> catalog signal (per-file indirection)
    KEY_Pos: KEY_Pos
  derived_signals:         # signals not on the bus, computed from others
    car_state:
      from: [door_latche_status, Led_Status]
      expr: "..."          # small expression language, see 1.2

rules:
  - id: CA_1
    title: Car must secure on key lock press
    component: driver_door           # 3D-twin mapping key
    severity: HIGH
    kind: response                   # response | absence | duration | invariant
    preconditions:
      - "KEY_Pos == 'Outside'"
      - "Drd_Status == 'Closed'"
    trigger: { signal: Key_Button_Status, to: 'Lock_Pressed' }
    expect:  { signal: car_state, becomes: 'secure' }
    deadline_ms: 600
    tolerance_pct: 10
    violation_title: "Car did not secure after lock button press"
    check_list:
      - "Key fob battery / KEY_Butt reaching the master"
      - "Driver door latch sensor (Drd_Status) wiring"
      - "Body gateway ↔ comfort ECU on Comfort_CAN"
```

Four `kind`s cover CA_1–CA_30:
- `response` — trigger edge → expected state within deadline (CA_1, CA_2, CA_6,
  CA_16–18, CA_24, CA_25). Outcomes: PASS / VIOLATED / TIMING_VIOLATED
  (report measured latency vs limit).
- `absence` — X must NOT occur while condition holds / within window
  (CA_8, CA_11, CA_12, CA_21, CA_22, CA_27).
- `duration` — state entered → state/output must hold or change after duration
  (CA_5, CA_23, CA_29).
- `invariant` — always-true mapping or allowed-transition set (CA_30 LED↔state,
  CA_10, plus the car-access state machine: any transition not on the allowed
  list = `ILLEGAL_TRANSITION` finding).

### 1.2 Predicate/expression language
Deliberately tiny: `signal op literal` with `== != < > in`, `and`-joined lists.
Derived signals: same expressions over other signals (no recursion). Parse at
file load; reject with line-precise errors. **No general scripting** (files are
user uploads — no code execution).

### 1.3 Storage, upload, car assignment (mirrors catalogs)
- `requirements/` directory next to `catalogues/`.
- New `RequirementSetEntity` (`requirement_sets` table: id, filename, name,
  version, uploadedAt) — mirror of `EcuCatalogEntity`.
- `car_requirement_sets` join table — mirror of `car_catalogs`
  (`CarEntity.catalogs`, CarEntity.java:86-98). Repository:
  `findRequirementFilenamesByCarId`.
- REST (mirror `CatalogController`, same `@PreAuthorize` model, new
  `requirement:read/write` authorities or reuse catalog:*):
  `GET /api/requirements`, `POST /upload` (parse-validate before accept),
  `GET/{filename}`, `GET/PUT /{filename}/source` (editor round-trip with
  timestamped backups — reuse `CatalogEditService` patterns),
  `DELETE /{filename}`, `POST /reload`.
- `RequirementLoaderService`: parse + cache per filename; explicit reload on
  save/upload + mtime check (same pattern as the decoder catalog reload).

### 1.4 Session scoping semantics (the dynamic-files rule)
- On first frame of a session: resolve car → assigned requirement filenames →
  **snapshot** the parsed rule sets for that session (like
  `sessionCatalogScope`). Mid-session file edits do NOT half-apply; they take
  effect on the next session. Empty assignment = requirements engine off for
  that session (do not fall back to "all files" — unlike catalogs, merging
  unrelated requirement sets produces false violations).
- Validation at load: every signal referenced by a rule must exist in one of the
  **car's assigned catalogs**; missing signals demote the rule to
  `NOT_EVALUABLE` (surfaced in coverage, never silently dropped).

### 1.5 Seed content
- Transcribe the requirements PDF (CA_1–CA_30) into
  `requirements/comfort_can_requirements.yaml`, including the state machine
  (unlocked / locked / secure / selective_unlock / unsecured) and CA_30 LED
  mapping. Ambiguous rows (CA_9 double-press, CA_28) marked `draft: true`
  (loaded, reported as NOT_TESTED, never VIOLATED) pending clarification.

**Acceptance**: upload → assign to car → session start logs "N rules armed for
session"; malformed file rejected with line errors; editor round-trip works.

---

## Phase 2 — Requirements evaluation engine (backend)

### 2.1 `RequirementMonitorService`
Runs on the Phase-0 per-session executor, called after integrity analysis with
the same frame + parsed signals. Per session state:
- `SignalStateTracker` — latest value per signal incl. derived (generalizes
  `latestSignals`), with previous value for edge detection.
- `EdgeDetector` — fires rule triggers on transitions, only if preconditions
  held **at trigger time** (snapshot them into the obligation).
- `ObligationQueue` — armed deadlines: `{ruleId, triggerTs, deadlineTs,
  expectation, contextSnapshot}`. Checked frame-driven AND by the Phase-0
  scheduler tick (so a violated deadline is raised even if no more frames come).
- `StateMachineTracker` — current car state + allowed-transition check.
- `AbsenceWatcher` — active windows during which listed events must not occur.
- Coverage counters per rule: PASS / VIOLATED / TIMING_VIOLATED / NOT_TESTED.
- `clearSession()` wired into the same lifecycle as the integrity analyzer.

Timing: deadlines evaluated in **frame-timestamp domain** (works for replayed
logs), with the arrival-clock sweeper as fallback for live streams that stop.

### 2.2 Findings model
Extend `IntegrityFaultEntity` (rename REST-side to "findings", keep table) with
nullable columns: `layer` (SPEC | REQUIREMENT | ML), `requirementId`,
`severity`, `evidenceJson` (trigger ts, deadline, observed value/latency),
`checkListJson`, plus Phase-0 `occurrences`. One store, one API, one WebSocket
topic (`/topic/findings`), one UI. Migration script in `db/`.

### 2.3 Report endpoint
`GET /api/sessions/{id}/requirements-report` → per rule: outcome, occurrences,
evidence refs; summary counts (exercised / pass / violated / not tested /
not evaluable). This is the auto-generated equivalent of the TC reports in the
requirements PDF.

**Acceptance**: golden-log integration test — a crafted log with one CA_1
violation, one CA_2 pass, one illegal transition produces exactly those
findings with correct latencies; re-run is deterministic.

---

## Phase 3 — Frontend

### 3.1 Findings panel (session inspector)
Severity-sorted cards: badge (CRITICAL/HIGH/MEDIUM/INFO), plain-language title +
requirement chip (CA_1), expandable: evidence timeline (trigger → deadline →
observed), context signals at trigger, check-list. Occurrence count on card.
Follows the new dark design system (`#0a0d12` / `#12161d` / lime accent).

### 3.2 Cross-view correlation
- Signal chart: finding markers at violation timestamps; clicking a finding
  zooms to the window and selects involved signals.
- Frame table: highlight frames in violation windows + "only frames involved in
  findings" filter.
- 3D twin: `component` key from the rule → mesh highlight (pulsing red) +
  tooltip with finding title; twin click filters the findings panel.

### 3.3 Requirements management UI
- Requirements list page (mirror catalog page): upload, delete, validate badge.
- Detail page with View / Edit / Source modes (reuse the catalog detail page
  patterns; Source = YAML with highlighting).
- Car edit page: requirement-set assignment next to catalog assignment.
- Session report tab rendering 2.3 (pass/fail table + drill-down).

---

## Phase 4 — ML layer rebuild (Python)

Replace `anomaly_scorer.py` with `anomaly_engine.py`:
1. **Per-message models keyed by catalog scope** (frames carry `catalog_files`,
   same as decoder scoping) — never mix cars/variants in one model.
2. Start deterministic-ish + explainable:
   - transition model per enum signal (observed transition matrix; never-seen
     transition → finding with the two states named);
   - inter-arrival model per cyclic message (robust percentile band on jitter).
3. IsolationForest per message type behind a flag; features: values, deltas,
   inter-arrival; threshold via `decision_function` percentile on baseline.
4. **Baselines from clean sessions only**: backend endpoint lists sessions with
   zero SPEC/REQUIREMENT findings; engine trains from those (kills
   self-poisoning). Model files versioned per catalog-scope hash.
5. Publish to `anomaly-events`; backend consumer maps to findings
   (`layer=ML`, severity INFO/LOW, title "Unspecified anomaly", evidence =
   feature that fired). ML findings never exceed LOW unless correlated (Phase 5).

---

## Phase 5 — Fusion + diagnostic guidance

- Correlator in backend on finding insert: merge ML findings overlapping a
  REQUIREMENT finding window (attach as supporting evidence, boost confidence);
  group findings sharing an ECU/subsystem (`messageSubsystems`) within a time
  window into a "probable root cause" cluster ("comfort ECU: 3 findings in 2s").
- Diagnostic KB: extend existing KB entries keyed by `requirementId` +
  `faultType` → probable causes ordered by likelihood; rule `check_list` is the
  seed, KB enriches. Surfaced in the findings card "What to check".

---

## Build order & estimates

| # | Work | Size |
|---|------|------|
| 0 | Fix integrity concurrency, dedup, sweeper, scorer stopgaps | S–M |
| 1 | Schema + loader + upload/assign endpoints + PDF transcription | M |
| 2 | Evaluation engine + findings model + report endpoint | L (core) |
| 3 | Findings UI + requirements management UI + report tab | M–L |
| 4 | ML rebuild | M |
| 5 | Fusion + KB enrichment | S–M |

Each phase ends with: backend `mvnw test` + compile, `ng build`, pytest, and a
golden-log replay check. Phases 0–3 deliver the full user-visible value; 4–5
layer on top without schema changes.

## Resolved decisions (2026-07-22)

1. **Derived signals**: BOTH paths supported per rule file — a rule may bind to
   a direct status signal when the car exposes one, or declare it in
   `derived_signals` computed from other signals. Nothing about state names is
   hardcoded in the engine.
2. **Authorities**: new `requirement:read` / `requirement:write` permissions.
3. **NK reference unavailable**: ambiguous example rules (CA_9, CA_28) are
   marked `draft: true` in the seed file.
4. **Generality (re-confirmed)**: the requirements PDF is ONLY an example of a
   user upload. The engine, schema, storage, and UI are fully generic — any
   requirement set, any car, any signal names. The seed YAML is sample content,
   not built-in behavior.
