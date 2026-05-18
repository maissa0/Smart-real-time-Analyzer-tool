# KPIT Smart Real-Time CAN Analyser — CHANGELOG

## Project Info
- Stack: Angular 21 Zoneless + Spring Boot 3.4.1 + Python 3.12 + Kafka 3.8 + MySQL 8 + InfluxDB 2.7
- Branch: m_version
- Author: Maissa Drira (PFE — ESPRIT / KPIT Technologies)

---

## [Session 1] — Initial Setup & Upload Pipeline
### Added
- Fleet Management page with vehicle CRUD and sessions per vehicle; dashboard quick-action links updated (`/admin/fleet`, workspace).
- File processing pipeline via `file_worker.py` consuming `file-processing-jobs`, streaming ASCII/BLF logs to `raw-can-frames`; legacy `pipeline.py` removed in favor of Kafka workers.
- Upload flow improvements: `LogFileEntity` created with `PROCESSING` on upload to avoid 404 on status poll.
- Public access to `/actuator/health` for health checks.

### Changed
- Unified analyser layout: vehicle filter in sniffer, Monitor renamed to Analyser in sidebar; preview pages replaced by **CAN Workspace** (sidebar, session list, upload, embedded simulator control).
- `ddl-auto`: `update` → `none` for explicit schema control.

### Fixed
- Kafka consumer: manual immediate acknowledgment and disabled auto-commit to avoid silent frame loss on errors.
- Race between `session-meta` and `decoded-signals`: retries / `REQUIRES_NEW` / removal of FK wait loop so frames save reliably.
- Session/frame persistence and decode path stability (multiple commits in the `saveFrame` / session-lookup area).

---

## [Session 2] — InfluxDB Integration
### Added
- **`InfluxWriteService`**: decode signals JSON → Influx `can_signals` points; absolute vs relative timestamp handling (epoch > 1e9 = live absolute, else `sessionStartTs + frameTs`).
- **`PlaybackService`**: server-side Influx playback job with fixed thread pool (max 10), WebSocket stream to `/topic/playback/{sessionId}`, 5-minute latch timeout, start/complete events.
- Influx session delete via REST delete API; `evictSessionCache` for session lifecycle.

### Changed
- Switched Influx **WriteApi to blocking** (`WriteApiBlocking`) — async writer was dropping writes.
- **Batch writes**: `writePoints(bucket, org, List<Point>)` per frame instead of one HTTP call per signal.

### Fixed
- Playback / query robustness: extended range in `queryAvailableSignals` (`-10y` vs `-30d`), `streamDone.await` timeout, WebSocket `retry(3)` + `catchError` on playback subscription.

---

## [Session 3] — Replay Engine
### Added
- **`ReplayEngineService`**: central signals for `currentTime`, `totalTime`, state (`idle|loading|playing|paused`), speed, points loaded/rendered; 16ms clock; `onTick` / `onSeek` hooks.
- **`ReplayBarComponent`**: play/pause/resume/stop, skip ±5s, speeds **0.1x–4x**, slider + points rendered / loaded badge; emits `playRequested`, `stopRequested`, `seekRequested`.
- Sniffer: `onReplayPlay` / `onReplayStop` / Influx playback wiring, frame table sync on tick, chart buffer + RAF for streaming points.

### Changed
- Playback Flux query: `range(start: 0)` with filters on `can_signals`, **`group(columns: ["session_id", "signal_name", "msg_id", "msg_name", "channel_name"])`** then `sort(columns: ["_time"])` — one series per signal (label variants merged).

### Fixed
- X-axis / time base: playback uses first Influx point as log-time base for uploaded vs live sessions (`sessionStartTs` in start event).
- Dynamic **`allSignalGroups`** from frame data — charts work for arbitrary catalog/sessions.

---

## [Session 4] — Live Simulation Pipeline
### Added
- **`can_simulator.py`**: publishes `session-meta` (`live_simulation`) and raw frames to Kafka; **`_produce_session_meta`** optional `status`; random/replay modes, fault injection, **`[SIM]`** debug prints per frame / session start.
- **`SimulatorController`**: starts Python `can_simulator.py` with validated log paths; **stop** destroys process and marks latest `live_simulation` session **COMPLETE** via `CanSessionRepository.findTopBySourceFilenameOrderByCreatedAtDesc`.
- **`LivePipelineComponent`**: four-stage UI (Simulator / WS / MySQL / Influx estimate), polls **`GET .../api/can/sessions/{id}`** every 2s for `frameCount`.
- **`CanKafkaConsumer`**: consumes `decoded-signals` → `saveFrame` → Influx → integrity → **`frameSink`**; **60Hz** batched broadcast to `/topic/frames/{sessionId}` and `/topic/live-telemetry`; session-meta forwarded to `/topic/sessions`.
- **`decoder.py`**: consumes `raw-can-frames`, produces `decoded-signals`; optional throttle; **`[DECODER]`** per-frame stdout.

### Changed
- CAN Workspace: **`onSimulatorStarted`** — reload sessions at 3s + 500ms, auto-select newest `live_simulation` where `status !== 'COMPLETE'`; 5s polling while running; **`onSimulatorStopped`** — staggered reloads at 1s / 3s / 6s.
- Sniffer: live WebSocket subscription, `startChartRaf` throttling (100ms when live), live chart group rebuild on first frames, `setTab('charts')` automation.

### Fixed
- Workspace uses **`SimulatorControlComponent`** in the panel so live sessions appear in the workspace session list (not a dead embedded sniffer).

---

## [Session 5] — Replay Bar & Relative Timestamps
### Added
- Sniffer template: **session complete** banner for `live_simulation` + `status === 'COMPLETE'`; conditional **replay bar** hiding incomplete live_simulation rows.
- **`sessionFirstTs`** computed: first frame timestamp or `selectedSession().startTs`; drives relative chart X, duration, recording date, replay tick/seek.

### Changed
- Replay bar slow speeds **0.1x** and **0.25x** added.
- **`loadFrames`**: live mode merges MySQL + ring-buffer frames and refreshes `liveChartGroups` from bindings.

### Fixed
- Replay visibility: completed **`live_simulation`** with **`COMPLETE`** shows replay bar; non-complete live rows excluded from bar until backend status updates.

---

## [Session 6] — Status Field & Live Detection Fix
### Added
- **`String status`** on **`CanSessionResponse`** record; **`toSessionResponse`** passes **`e.getStatus()`** so JSON includes status for list/detail APIs.
- Angular **`CanSession.status?: string | null`**.

### Changed
- **`selectSession()`**: **`isLive`** for `live_simulation` no longer depends on `frameCount`; uses **`status !== 'COMPLETE'`** and **`status` in `null | undefined | '' | 'LIVE'`** so auto-selected sessions with frames still count as live.

### Fixed
- Frontend previously saw **`status: undefined`** because the REST DTO omitted `status` — resolved by extending **`CanSessionResponse`** and mapper.

---

## Commit History
```
d98429ec fix: add status field to CanSessionResponse — frontend now receives session status correctly
789a3521 debug: add console logs to trace live session flow, fix session complete message condition
77b5f1a0 fix: live charts update in real-time — rebuild groups on first frame, empty datasets for appendPoint
52687172 feat: auto-select live session on simulator start, live pipeline counter showing WS/MySQL/InfluxDB frames
d8f2aed9 fix: SimulatorController.stop() marks most recent live_simulation session as COMPLETE in MySQL
fc099505 fix: completed live_simulation sessions show replay bar — check status COMPLETE
c1e6f17f fix: add 0.1x and 0.25x slow speed options to replay bar
fc8fa7c6 fix: replace embedded sniffer in simulator panel with SimulatorControlComponent — live sessions now appear in workspace session list
b7fb38bd fix: group InfluxDB playback query by signal_name — merges label variants into single series per signal
a441c6a0 fix: playback uses first InfluxDB point as time base — fixes X axis for uploaded files with different recording date
842d3bef fix: dynamic signal groups — charts now work for any CAN session, fix InfluxDB range query
f43ae6b1 fix: dashboard quick action points to /admin/workspace
3f2b6be4 feat: replace preview pages with CAN Workspace — clean sidebar, unified session+upload+simulator layout
0f4a9300 feat: unified analyser — vehicle filter in sniffer, remove redundant simulator page, rename Monitor→Analyser in sidebar
463abba8 fix: update dashboard Vehicles quick action to /admin/fleet
027241d5 feat: add Fleet Management page — vehicle CRUD, sessions per vehicle, fix dead /admin/vehicles link
0562e940 fix: switch InfluxDB WriteApi to blocking — async WriteApi was silently dropping all writes
18aeee28 fix: remove session FK wait loop — FK constraint dropped, frames save directly
fdeea0e9 fix: use REQUIRES_NEW + 20 retries in saveFrame to avoid stale transaction cache on session lookup
bff9f588 fix: retry session lookup in saveFrame — handles race condition between decoded-signals and session-meta Kafka topics
bea8e36e fix: create LogFileEntity with PROCESSING status on upload — prevents 404 on status poll
1d5c8e6a fix: allow public access to /actuator/health for health checks
7669fb9c feat: add playback progress bar — shows % complete and point count during InfluxDB replay
5d3cae00 fix: default pipeline.python.executable for SimulatorController after removing properties
4ad559f9 chore: remove legacy pipeline.py and its application.properties references — superseded by file_worker.py + Kafka
c0cbad7f fix: add retry(3) + catchError to playback WebSocket subscription — prevents frozen UI on disconnect
c2ea9deb fix: replace hardcoded -30d range with -10y in queryAvailableSignals — sessions older than 30 days no longer lose their signals
fa003bec fix: ddl-auto=update → none — schema managed manually, prevents accidental ALTER on startup
511ef0f5 fix: add 5-minute timeout to PlaybackService streamDone.await() — prevents thread pool exhaustion
97cca008 fix: disable Kafka auto-commit, use MANUAL_IMMEDIATE ack to prevent frame loss on error
```
*(Captured with `git -C C:/tools/Kpit_c log --oneline --all | Select-Object -First 30`; first 30 lines.)*

---

## Debug Logs Currently Active (to be removed before production)

### Angular (sniffer.component.ts)
- `[selectSession]` logs session object + isLive flag
- `[live] frame received` logs every WebSocket frame (buffer / groups / tab)
- `[live] buildLiveChartGroupBindings` logs group count and `allFrames` length

### Backend (CanKafkaConsumer.java)
- `[BACKEND] Session meta saved: {}` (full message)
- `[BACKEND] frame saved: id session msg ts`
- `[BACKEND] frame emitted to WebSocket sink: id`
- `[WS] broadcasting N frames to /topic/frames/{sessionPrefix}`
- `[WS] batch broadcast complete: N total frames`

### Python
- `[SIM] session started: ...` and `[SIM] frame #N msg=...` (`can_simulator.py`)
- `[DECODER] #N session msg name signals ts` (`decoder.py`)

---

## Known Issues & Pending Tasks

### Immediate
- [ ] Verify status: null (not undefined) appears in `[selectSession]` log
- [ ] Verify isLive: true appears after simulator starts
- [ ] Verify `[live] frame received` logs appear continuously
- [ ] Verify charts animate in real-time
- [ ] Verify pipeline counter (4-stage) appears above charts
- [ ] Verify stopping simulator switches session to COMPLETE
- [ ] Verify replay works on completed live_simulation session

### Bug — GET 405 Every 2 Seconds
- **`LivePipelineComponent`** polls **`GET ${API_BASE_URL}/api/can/sessions/${sid}`** for MySQL frame count. If this route returns **405 Method Not Allowed** or is missing for session-by-id, fix the controller mapping or URL.

### Week 3 — Replay Polish
- [ ] Playhead line on charts during replay
- [ ] Frame table scroll sync during replay

### Week 4 — Cleanup
- [ ] Remove all debug `console.log` from Angular
- [ ] Remove `[SIM]` `[DECODER]` `[BACKEND]` `[WS]` logs from backend/python
- [ ] Delete dead components: MonitorPageComponent, SimulatorPageComponent
- [ ] Delete dead service: SimulatorStateService
- [ ] Fix workspace connected signal (always shows Offline)
- [ ] Fix CSV export hardcoded localhost:8080
- [ ] Fix filter panel (Message ID / Bus filters non-functional)

### Week 5 — Pipeline Status Dashboard
- [ ] Real counters endpoint in backend
- [ ] Replace estimated InfluxDB count with real data

---

## Architecture — Data Flow

```
can_simulator.py
  → Kafka topic: raw-can-frames
decoder.py
  → Kafka topic: decoded-signals
CanKafkaConsumer.java
  → MySQL (can_frame table)
  → InfluxDB (signal time series)
WebSocket /topic/frames/{sessionId}
Angular sniffer component
  → Live mode: charts animate from WebSocket frames
  → Replay mode: charts animate from InfluxDB via PlaybackService
```
