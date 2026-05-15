# KPIT Smart Real-Time CAN Analyser — Complete Test Checklist

This checklist is derived **only** from the audited backend controllers, `SecurityConfig.java`, the listed Angular routes/components, and the listed Python modules.

---

## Shared reference (from audited files only)

### CORS / app origin (`SecurityConfig.java`)

- Allowed origin: **`http://localhost:4200`**
- Allowed methods: **GET**, **POST**, **PUT**, **PATCH**, **DELETE**, **OPTIONS**

### Authentication (`SecurityConfig.java` + Angular HTTP usage)

- **Stateless JWT** — `SessionCreationPolicy.STATELESS`
- Paths **without** authentication (exact entries from `PUBLIC_PATHS` in `SecurityConfig.java`):
  - `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, `/api/auth/verify-otp`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/mfa/verify`
  - `/v3/api-docs/**`, `/swagger-ui/**`, `/swagger-ui.html`
  - `/ws-ecu-gateway/**`, `/ws-ecu-gateway`
  - `/api/can/sessions/*/frames/export.csv` (pattern as declared)
- **All other requests**: `anyRequest().authenticated()`

### Authorization header format (from Angular components reviewed)

For APIs that require auth, callers use **`localStorage` key `access_token`** and HTTP header:

```http
Authorization: Bearer <access_token>
```

(where `<access_token>` is the raw JWT string stored by the client — see `monitor-page.component.ts` `headers()`, `session-list.component.ts`, `simulator-control.component.ts` `authHeaders()`, `upload-page.component.ts` `authHeaders()`.)

**CSV export (Sniffer)** uses a browser download URL with query token (`sniffer.component.ts` computed `csvExportUrl`):

- `http://localhost:8080/api/can/sessions/{sessionId}/frames/export.csv?token={token}`

The audited `SecurityConfig` marks the CSV path as **permitAll**; the `?token` query behaviour is **not specified** in `CanController.java` or `SecurityConfig.java` beyond the permitted path pattern.

### Login credentials & MySQL

- **Exact login credentials (username/password):** *not present in any of the files audited for this checklist.*
- **Exact MySQL connection URL / hostname / credentials:** *not present in any of the files audited for this checklist.*

---

# Backend API

## CAN sessions & frames (`CanController`)

### List sessions (full list vs paginated)

**How to test:** Call GET without pagination; then call GET with integer `page` and `size`; verify shape matches service (full list vs `Page`).

**Endpoint / URL:** `GET /api/can/sessions` — optional query: `page`, `size` (both required together for pagination per controller logic).

**Expected result:** If `page` or `size` is null → full session list (`getAllSessions()`). If both provided → paginated (`getSessions(page, size)`).

**Pass condition:** □

### List frames (filters & pagination rules)

**How to test:** For a known `sessionId`, call variants below; observe list vs pagination and filter behaviour described in controller.

**Endpoint / URL:** `GET /api/can/sessions/{sessionId}/frames`

Query parameters (from controller):

| Param | Meaning |
|--------|---------|
| `msgId` | optional filter by message ID |
| `faultsOnly` | boolean, default `false` |
| `anomalyOnly` | boolean, default `false` |
| `page` | optional integer — **pagination active when present** |
| `size` | int, **default `500`** when paging |

**Expected result:**

- If `faultsOnly=true`: returns **full** fault frame list (**pagination overridden**).
- If `anomalyOnly=true`: returns **`List.of()`** — **[DEFERRED]** placeholder (comment: AI sprint not yet implemented).
- If `page` present: paginated (`getFramesBySessionPaged` or `getFramesBySessionAndMsgIdPaged` when `msgId` non-blank).
- If `page` absent: backward-compatible non-paged list (`getFramesBySession` / `getFramesBySessionAndMsgId`).
- **`msgId`** when paging: combine with `page`/`size` for `getFramesBySessionAndMsgIdPaged`.

**Pass condition:** □

### Frame count for session

**How to test:** GET for an existing vs non-existing session; compare `count` with DB or UI pagination.

**Endpoint / URL:** `GET /api/can/sessions/{sessionId}/frame-count`

**Expected result:** JSON body includes `sessionId` and `count` (`Long`).

**Pass condition:** □

### Export session frames as CSV (public HTTP path pattern)

**How to test:** Download CSV; inspect headers (`Content-Disposition`, `Content-Type`) and CSV header row matching builder in controller.

**Endpoint / URL:** `GET /api/can/sessions/{sessionId}/frames/export.csv`

**Expected result:** `200` with CSV body; columns: `id,sessionId,timestamp,channel,channelName,msgId,msgName,direction,rawBytes`. Path is **`permitAll`** in `SecurityConfig` (`/api/can/sessions/*/frames/export.csv`).

**Pass condition:** □

### Delete CAN session

**How to test:** DELETE with JWT; verify MySQL deletion result + `influxDeleted: true` in JSON; test unknown session → `404`; error path → `500` body with message.

**Endpoint / URL:** `DELETE /api/can/sessions/{sessionId}`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** Deletes via `canSessionService.deleteSession` then `influxWriteService.deleteSession`; success body merges MySQL result + `influxDeleted: true`. `RuntimeException` with “Session not found” → `404`.

**Pass condition:** □

---

## Cars (`CarController`)

### List cars

**How to test:** GET with valid JWT; compare with fleet data.

**Endpoint / URL:** `GET /api/cars`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** `200` with `List<CarDto>` (comment in code: all active cars for authenticated users in current deployment).

**Pass condition:** □

### Create car

**How to test:** POST JSON body matching `CarCreateRequest` validation (`@Valid`); use authenticated user.

**Endpoint / URL:** `POST /api/cars`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** `201 Created` with `CarDto`.

**Pass condition:** □

### Get / update / soft-delete car

**How to test:** GET by `carUid`; PUT with `CarUpdateRequest`; DELETE for soft-delete.

**Endpoint / URL:**

- `GET /api/cars/{carUid}`
- `PUT /api/cars/{carUid}`
- `DELETE /api/cars/{carUid}`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** GET/PUT → `200` with `CarDto`; DELETE → `204 No Content`.

**Pass condition:** □

### List sessions for a car

**How to test:** GET with valid `carUid`; invalid → `404` “Car not found”.

**Endpoint / URL:** `GET /api/cars/{carUid}/sessions`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** `200` with `List<CanSessionResponse>`.

**Pass condition:** □

---

## Simulator (`SimulatorController`)

### Start simulator process

**How to test:** POST JSON matching keys read by controller: `mode`, `logFile`, `speed`, `loop`, fault flags, `faultRate`, `carUid`; for `replay` + `logFile`, verify path traversal blocked (400) when resolved path escapes allowed base (`validateLogFilePath`).

**Endpoint / URL:** `POST /api/simulator/start`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** On success → `200` with `simId`, `status` (`started`), `mode`. On outer failure → `500` body `error`. `ResponseStatusException` (bad path) → `400`.

**Pass condition:** □

### Stop one / stop all simulator(s)

**How to test:** POST stop known `simId`; POST stop-all.

**Endpoint / URL:**

- `POST /api/simulator/stop/{simId}`
- `POST /api/simulator/stop-all`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** Stop unknown `simId` → `404`; success → bodies with status / `stopped` count per controller.

**Pass condition:** □

### Simulator status

**How to test:** GET while processes running vs idle; inspect `simulators` array + convenience flat fields (`running`, `pid`, `startedAt`, `mode`, `simId`).

**Endpoint / URL:** `GET /api/simulator/status`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** `200` with described map structure (`framesProduced` is explicitly `null` in Java).

**Pass condition:** □

---

## Log upload & history (`LogUploadController`)

### Upload CAN log file

**How to test:** Multipart `file`; empty → 400 error; unsupported extension → 400; success → `sessionId`, `PROCESSING`.

**Endpoint / URL:** `POST /api/logs/upload` — form field **`file`** (`MultipartFile`)

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** Allowed extensions per controller: `.txt`, `.log`, `.asc`, `.blf`. Success: `sessionId`, `filename`, `status` `PROCESSING`.

**Pass condition:** □  
**Note:** `upload-page.component.ts` optionally appends `carUid` in `FormData`; **`LogUploadController` audited code only declares `@RequestParam("file")`** — extra fields are client-side unless another layer consumes them elsewhere.

### Upload processing status by sessionId

**How to test:** GET after upload for returned `sessionId`.

**Endpoint / URL:** `GET /api/logs/status/{sessionId}`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** JSON with `sessionId`, `filename`, `status`, `frameCount`, `fileSize`, `channelCount`, `durationSeconds`, `createdAt`; missing → `404`.

**Pass condition:** □

### Upload history

**How to test:** GET with/past default `size`.

**Endpoint / URL:** `GET /api/logs/history?size=<int>` — **`size` default `10`** in controller.

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** `200` list of maps (`id`, `sessionId`, `filename`, `status`, `frameCount`, `fileSize`, `createdAt`).

**Pass condition:** □

### Retry failed upload

**How to test:** POST with known `logFileId` entity id.

**Endpoint / URL:** `POST /api/logs/retry/{logFileId}`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** Success → `sessionId`, `PROCESSING`; missing id → `404`; exception → `500` body `error`.

**Pass condition:** □

---

## Dashboard (`DashboardController`)

### Aggregated dashboard stats (cached endpoint)

**How to test:** First call triggers log “Computing dashboard stats (cache miss)”; `@Cacheable("dashboard-stats")` — subsequent calls within cache TTL behave per Spring Cache config (**TTL not declared in audited controller source**).

**Endpoint / URL:** `GET /api/dashboard/stats`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** `200` `DashboardStatsDto` with `sessionCount`, `totalFrames`, `activeSessions`, `totalFaults`, `faultsByType`, `topMessageIds`, `totalCars`.

**Pass condition:** □

### Recent sessions widget

**How to test:** GET with/default `size`; request `size>20` capped to **20** in controller.

**Endpoint / URL:** `GET /api/dashboard/recent-sessions?size=<int>` — **`size` default `5`**, **`size` capped at 20**.

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** `200` `List<CanSessionResponse>` (first `size` items from `getAllSessions()` stream).

**Pass condition:** □

---

## Playback (`PlaybackController`)

### Start / stop / status playback

**How to test:** POST start with JSON `sessionId` (required), optional `startTs`, `endTs`, `speed`, `signals` list; then GET status; POST stop.

**Endpoint / URL:**

- `POST /api/playback/start`
- `POST /api/playback/stop/{playbackId}`
- `GET /api/playback/status/{playbackId}`

**Authorization:** `Authorization: Bearer <access_token>`

**Expected result:** Start success → `playbackId`, `sessionId`, `status` `started`, `topic` `/topic/playback/{sessionId}`. Missing `sessionId` → `400` `error`. Stop not found → `404`. Status → `active` boolean.

**Pass condition:** □

---

# Frontend pages (routes from `app.routes.ts` + audited components)

Base admin layout: routes under `path: 'admin'` with `canActivate: [authGuard]`.

| Route path (Angular) | Primary component audited |
|------------------------|---------------------------|
| `''` → `auth/login` | (auth feature not in audit list) |
| `admin` (default child `''`) | `dashboard.component.ts` |
| `admin/monitor` | `monitor-page.component.ts` |
| `admin/simulator` | `simulator-page.component.ts` |
| `admin/upload` | `upload-page.component.ts` |
| `admin/sniffer` | `sniffer.routes.ts` → `sniffer.component.ts` |
| `**` → `auth/login` | — |

### Dashboard (`/` → redirect; after login: `admin` default)

**How to test:** Open `http://localhost:4200/admin` (post-login). Observe `DashboardStore.loadStats()` on init and `interval(30_000)` refresh; KPI cards bound to `store.stats()`; `LiveTelemetryService.connected()` in header; “View All” calls `goTo('/admin/sniffer')`; session row `openSession` navigates with `queryParams: { sessionId }`; quick actions navigate to `/admin/simulator`, `/admin/upload`, `/admin/monitor`, `/admin/vehicles`.

**Endpoint / URL:** Browser: **`/admin`** (Angular). Backing APIs used by dashboard store are **not defined in audited dashboard TS** (only `/admin/sniffer` navigations cited here).

**Expected result:** Charts/KPI/error/loading branches per template `@if`; recent sessions clickable.

**Pass condition:** □

### Live Monitor (`/admin/monitor`)

**How to test:** Vehicle `<select>` triggers `onVehicleChange` → `loadSessions(carUid)` with URL `GET {API_BASE_URL}/api/cars/${carUid}/sessions` vs `GET {API_BASE_URL}/api/can/sessions`; session cards call `selectSession`; frame stream exercises `togglePause`, `toggleAutoScroll`, `onMsgIdFilter`, `clearFrames`, `liveTelemetry.frames$` subscription; embedded `<app-sniffer ... [liveOnly]="true" [hideUpload]="true" [hideSimulator]="true" [kpitMonitorChartTheme]="true">'`.

**Endpoint / URL:** **`http://localhost:4200/admin/monitor`** + HTTP GET patterns above (`API_BASE_URL` from `api.config.ts` — **not audited**).

**Expected result:** `displayedFrames` reflects `msgIdFilter`; pause buffers up to **200** frames; append caps **500** `MAX_FRAMES`.

**Pass condition:** □

### CAN Simulator page (`/admin/simulator`)

**How to test:** `app-simulator-control` emits `simulatorStarted` / `simulatorStopped`; `autoSelectLive` signal toggled after 3s start / reset on stop; `<app-sniffer [hideUpload]="true" [hideSimulator]="true" [liveOnly]="true" [autoSelectLive]="autoSelectLive()">`.

**Endpoint / URL:** **`http://localhost:4200/admin/simulator`**. Control POSTs **`POST ${API_BASE_URL}/api/simulator/start`** etc. (`simulator-control.component.ts`, `API_BASE_URL`/`/api/simulator` base).

**Expected result:** Live-only sniffer list shows `live_simulation` sessions when backend produces them.

**Pass condition:** □

### Simulator control component (embedded in Sniffer & Simulator page)

**How to test:** Mode `random` vs `replay` (shows `logFile` input); `startSimulator()` builds body with `speed: frequency/10`, fault checkboxes, `POST ${base}/start`; `stopSimulator()` `POST ${base}/stop/{id}`; `pollStatus` `GET ${base}/status`; `loadCars` `GET /api/cars`; auth via `Authorization: Bearer <access_token>`.

**Endpoint / URL:** Same as backend simulator routes; UI in parent templates.

**Expected result:** `simId` from `SimulatorStateService`; default `logFile` string in component: **`C:/tools/Kpit_c/log_file.txt`** (from source).

**Pass condition:** □

### Log upload page (`/admin/upload`)

**How to test:** Drag/drop or file input `accept=".log,.asc,.blf,.txt"`; `upload()` `HttpRequest` **`POST ${API_BASE_URL}/api/logs/upload`** with `reportProgress`; poll **`GET ${API_BASE_URL}/api/logs/status/${sessionId}`** every 2s; history **`GET ${API_BASE_URL}/api/logs/history?size=10`**; retry **`POST .../api/logs/retry/${logFileId}`**; `viewSession` → `router.navigate(['/admin/sniffer'], { queryParams: { sessionId } })`.

**Endpoint / URL:** **`http://localhost:4200/admin/upload`**

**Expected result:** Step machine `idle` → `uploading` → `processing` → `complete`/`error`; status normalisation as in `pollProcessingStatus`.

**Pass condition:** □

### Sniffer — session list child (`SessionListComponent`)

**How to test:** Initial `loadSessions(true)` + `interval(5_000)` refresh; `loadMore` increments `page` and appends; URL without `carId`: **`GET ${API_BASE_URL}/api/can/sessions?page=${page}&size=${pageSize}`** (`pageSize` **20**); with `carId` input: **`GET ${API_BASE_URL}/api/cars/${carId}/sessions`**; selection emits `sessionSelected`; `liveOnly` input filters `sourceFilename === 'live_simulation'`.

**Endpoint / URL:** **`http://localhost:4200/admin/sniffer`**

**Expected result:** Paginated response shape `{ content, hasMore }` vs array handled in `next` handler.

**Pass condition:** □

### Sniffer — main component + template (upload, simulator, filters, tabs, playback)

**How to test:** Exercises `loadSessions` via `canService.getSessionsPaged(0, pageSize)` (**pageSize 20**), `loadMoreSessions`, `selectSession` (live vs recorded, `liveTelemetry.connectToSession`, URL `queryParams sessionId`), `loadFrames` + `frameApiFilters` (`faultsOnly`, `anomalyOnly`, `selectedMsgId`), filter UI in `sniffer.component.html` (`onAddressFilterChange`, `toggleFaultsOnly`, `toggleAnomalyOnly` — **anomaly API is placeholder on backend**), tabs `setTab('table'|'charts'|'integrity')`, playback bar + `togglePlayback` / `TelemetryService`, Influx replay `startInfluxPlayback` / `stopInfluxPlayback` / `canService.startPlayback`, export anchor `csvExportUrl`, **`navigateToAi()` → `/admin/ai`** — **route not declared in audited `app.routes.ts`** → treat as **[DEFERRED] / out-of-audit-scope navigation**.

**Endpoint / URL:** **`http://localhost:4200/admin/sniffer?sessionId=...`** (deep link restore after 800ms / 2000ms retry in `ngOnInit`).

**Expected result:** Template branches for `hideUpload`, `hideSimulator`, `liveOnly`, `uploadOnly` inputs; keyboard: **Space** toggles playback (non-live), **ArrowLeft/Right** seek when not live.

**Pass condition:** □

### Sniffer — frame table (`FrameTableComponent`)

**How to test:** Pass `frames`, `sessionStartTs`, `visibleSignalNames`, `faultsByFrameId` from parent; click row / expand button `toggleExpand`; `parseSignals` JSON parse.

**Endpoint / URL:** Rendered inside Sniffer table tab only.

**Expected result:** Empty state “No frames to display”; fault badge when `faultsByFrameId` contains `frame.id`.

**Pass condition:** □

---

# Python pipeline (audited modules)

### `xml_decoder.py` — catalogue load & CLI smoke

**How to test:** Run module: `python xml_decoder.py` (uses `load_catalog` on `catalogues` beside file); verify printed message count and per-message lines from `if __name__ == "__main__"` block.

**Endpoint / URL:** N/A (CLI)

**Expected result:** Exits 0; logs parse errors per `try/except` around `ET.parse` (skips bad files).

**Pass condition:** □

### `xml_decoder.py` — `load_catalog`, `decode_frame`, `encode_frame`, `_msg_id_key`

**How to test:** Unit-style: `load_catalog(Path)` merge; `decode_frame` known `msg_id` + bytes vs unknown id (empty list); `encode_frame` round-trip for catalogued message.

**Endpoint / URL:** N/A

**Expected result:** Matches function contracts in file docstrings.

**Pass condition:** □

### `log_parser.py` — `get_ascii_metadata`

**How to test:** Point at sample ASCII log; verify dict keys: `file_size`, `start_ts`, `end_ts`, `channel_count`, `channel_names`, `frame_count_estimate`, `format`.

**Endpoint / URL:** N/A

**Expected result:** Head/tail read behaviour as documented (first 100 / last 100 lines).

**Pass condition:** □

### `log_parser.py` — `parse_log_stream` vs `parse_log`

**How to test:** Stream large file with `parse_log_stream` iterator; compare frame count / last frame to `parse_log` `ParsedSession` for same file.

**Endpoint / URL:** N/A

**Expected result:** `DecodedFrame` fields populated; `UNKNOWN` msg when id missing from catalog.

**Pass condition:** □

### `log_parser.py` — `__main__` CLI

**How to test:** `python log_parser.py <log_path> <catalogues_dir>` — expects **exactly 2 args** or exit code **2** and usage message.

**Endpoint / URL:** N/A

**Expected result:** Prints frame count, unique IDs, first 3 frames JSON.

**Pass condition:** □

### `can_simulator.py` — `build_argparser` & `main` / `CanSimulator.run`

**How to test:** `--mode random` vs `--mode replay --log <path>`; flags: `--catalogues`, `--kafka`, `--speed`, `--loop`, `--car-uid`, fault injection flags, `--fault-rate`; Ctrl+C in random mode prints footer with `frame_counter` and `fault_stats`.

**Endpoint / URL:** N/A (invoked by backend `SimulatorController` as `can_simulator.py` with constructed args)

**Expected result:** `CanSimulator.run` dispatches `run_replay` vs `run_random`; Kafka `Producer` with `bootstrap.servers`, `linger.ms`, `compression.type` lz4.

**Pass condition:** □

### `decoder.py` — `CanDecoderService` & Kafka helpers

**How to test:** Run service with `--catalogues` and `--kafka` / `--group` per module docstring; verify consumer `raw-can-frames`, manual commit (`enable.auto.commit` **False** in `make_consumer`), producer to decoded path per class docstring.

**Endpoint / URL:** N/A

**Expected result:** `delivery_report` logs delivery failures; service loop behaviour per `CanDecoderService` implementation (full file not exhaustively re-listed here).

**Pass condition:** □

### `file_worker.py` — job consumer & publishers

**How to test:** Run `file_worker.py` per module usage lines; exercise `publish_session_meta`, `publish_raw_frame`, `publish_log_file_event` via job processing path; ASCII via `parse_log` / `parse_log_stream` / metadata helpers from `log_parser`; BLF via `static_parser` imports declared in file header.

**Endpoint / URL:** N/A

**Expected result:** Topics and payload shapes match `publish_*` functions in audited portion.

**Pass condition:** □

### `pipeline.py` — **[NOT AUDITED]**

**How to test:** *File was not in the audit list — no checklist items derived.*

**Endpoint / URL:** N/A

**Pass condition:** □ (N/A)

---

## Summary counts (for the report line)

| Category | Count |
|----------|------:|
| **Distinct backend HTTP operations** (method + path, from controllers) | **24** |
| **Frontend checklist sections** (`###` under “Frontend pages”) | **8** |
| **Python checklist sections** (`###` under “Python pipeline”, excluding N/A pipeline note) | **8** |

---

*End of checklist.*
