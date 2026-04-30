# Snoffer — Smart Real-Time CAN Analyzer
## Complete Project Technical Report

**Author:** Molka Elleuch
**Last updated:** 2026-04-26
**Branch:** `molka_version`
**Stack:** Spring Boot 3.3.5 · Angular 17 · Python 3.10 · Kafka · PostgreSQL · MinIO

---

## Section 1 — Project Overview

Snoffer is a full-stack real-time CAN (Controller Area Network) bus analyzer built as a final-year engineering project. It decodes raw CAN log files against XML signal definitions, streams decoded frames to a browser UI in real time, detects anomalies using rule-based and statistical engines, and provides a live simulator for generating synthetic CAN traffic.

**Core capabilities:**
- Upload `.txt` / `.log` / `.asc` / `.blf` CAN log files and decode every signal against XML catalogs
- Stream decoded frames to the browser live (SSE or Kafka pipeline) or deliver in one batch (WebSocket, 60 Hz)
- Detect anomalous frames via a rule engine and an Isolation Forest model
- Simulate live CAN traffic with configurable scenarios and fault injection
- Manage users, sessions, MFA, audit logs, and file upload history
- Forward live or replayed frames to a Unity 3D vehicle model

---

## Section 2 — Architecture Overview

```
┌──────────────┐       WebSocket / SSE / REST        ┌───────────────────┐
│  Angular 17  │ ◄──────────────────────────────────► │  Spring Boot 3.3.5 │
│  (port 4200) │                                      │  (port 8082)       │
└──────────────┘                                      └────────┬──────────┘
                                                               │
                    ┌──────────────────────────────────────────┤
                    │               │              │            │
             ┌──────▼──────┐ ┌─────▼─────┐ ┌────▼────┐ ┌────▼────┐
             │  PostgreSQL  │ │   Kafka   │ │  MinIO  │ │ Python  │
             │  (port 5432) │ │(port 9092)│ │(9000-01)│ │ Parser  │
             └─────────────┘ └───────────┘ └─────────┘ └─────────┘
```

- **Spring Boot** is the central hub: it receives file uploads, launches the Python worker, pushes frames to Kafka, and serves both REST and WebSocket endpoints.
- **Python parser** runs as a persistent warm worker process (started once, reused across requests). Spring Boot sends jobs to it over stdin and reads decoded frames from stdout line by line.
- **Kafka** carries decoded frames, anomaly alerts, progress events, and session metadata between processes in async mode.
- **PostgreSQL** stores users, sessions, audit logs, OTP tokens, and upload records.
- **MinIO** stores uploaded CAN log files (S3-compatible). A local filesystem fallback is also implemented.
- **Angular** connects via STOMP/SockJS WebSocket for real-time frame delivery, and via REST for everything else.

---

## Section 3 — Technology Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Frontend | Angular | 17 | Standalone components, no NgModules |
| Frontend | STOMP.js + SockJS | latest | WebSocket client |
| Frontend | Chart.js + chartjs-plugin-zoom | latest | Signal charts |
| Backend | Spring Boot | 3.3.5 | Maven wrapper |
| Backend | Spring Security | 6.x | JWT stateless, BCrypt |
| Backend | Spring WebSocket | 6.x | STOMP broker relay |
| Backend | Spring Kafka | 3.x | Producers + consumers |
| Backend | JPA / Hibernate | 6.x | PostgreSQL ORM |
| Backend | Jackson | 2.x | JSON + JavaTimeModule |
| Parser | Python | 3.10 | Subprocess worker |
| Parser | python-can | latest | BLF file reading |
| Parser | scikit-learn | latest | Isolation Forest |
| Infra | Kafka + Zookeeper | Docker | port 9092 |
| Infra | PostgreSQL | Docker | port 5432 |
| Infra | MinIO | Docker | ports 9000–9001 |
| Auth | TOTP (pyotp / qrcode) | — | MFA support |

---

## Section 4 — Backend Structure

```
smart-analyzer-backend/src/main/java/com/molka/smart_analyzer_backend/
├── config/
│   ├── KafkaConfig.java              # topic declarations, producer/consumer factories
│   ├── ObjectMapperConfig.java       # JavaTimeModule, WRITE_DATES_AS_TIMESTAMPS=false
│   ├── RateLimitConfig.java          # request rate limiting
│   ├── S3Config.java                 # MinIO S3 client bean
│   ├── SchedulingConfig.java         # @EnableScheduling
│   ├── SecurityConfig.java           # JWT filter chain, CORS, role rules
│   └── WebSocketConfig.java          # STOMP broker, /ws endpoint
├── controller/
│   ├── AnalysisController.java       # POST /api/analyze, /api/analyze-stream, /api/analyze/async
│   ├── AuditLogController.java       # GET /api/audit/me, /api/audit/all (ADMIN)
│   ├── FrameController.java          # frame persistence endpoints
│   ├── HealthController.java         # GET /api/health/kafka
│   ├── SessionController.java        # session list, revoke
│   ├── SimulationController.java     # WebSocket /app/simulate/*
│   ├── UnityController.java          # POST /api/unity/frame, /api/unity/mode
│   ├── UploadController.java         # GET /api/uploads/me, POST /api/uploads/{id}/reanalyze
│   └── UserController.java           # /api/users/*, /api/users/me
├── dto/                              # AuthResponse, LoginRequest, UpdateMeRequest, …
├── entity/                           # User, Frame, UploadRecord, SessionEntity, AuditLogEntity, OtpEntity
├── exception/                        # AuthFailureException
├── kafka/
│   ├── AnomalyKafkaConsumer.java     # consumes can-frames-anomalies → /topic/anomalies WS
│   ├── AsyncAnalysisConsumer.java    # consumes can-frames-decoded → /topic/async-frames/{sid}
│   └── DecodedFrameKafkaConsumer.java
├── repository/                       # Spring Data JPA repos
├── security/
│   ├── CustomUserDetailsService.java
│   ├── JwtAuthenticationFilter.java  # OncePerRequestFilter — Bearer token extraction
│   └── JwtTokenProvider.java
├── service/
│   ├── AnalysisService.java          # warm Python worker lifecycle + job dispatch
│   ├── AuditLogService.java
│   ├── EmailService.java
│   ├── MfaService.java               # TOTP secret generation + verification
│   ├── OtpService.java               # password-reset OTP
│   ├── SessionService.java
│   └── UserService.java
├── simulator/
│   ├── SimulationEngine.java         # frame generation loop, scenario runner
│   ├── SimulationController.java     # STOMP /app/simulate/start|pause|stop|reset|speed|fault|scenario
│   ├── XmlDefinitionLoader.java      # loads XML signal defs for simulator
│   ├── CanFrameConsumer.java
│   ├── MessageDef.java / SignalDef.java / ValidValue.java
│   ├── ScenarioType.java / FaultPayload.java / SpeedPayload.java / SimulatorFrame.java
└── storage/
    ├── StorageService.java           # interface
    ├── LocalStorageServiceImpl.java  # filesystem fallback
    └── S3StorageServiceImpl.java     # MinIO production impl
```

---

## Section 5 — Python Parser

**File:** `python_parser/parser.py`

The parser is the signal-decoding engine. It loads XML signal catalogs once, then processes CAN frames on demand.

### Operating modes

| Flag | Mode | Description |
|---|---|---|
| *(none)* | Batch | Decodes all frames, writes `decoded_frames.json` + `error_report.json` |
| `--stream` | SSE stream | Prints each decoded frame as a JSON line to stdout; Spring Boot reads line-by-line |
| `--worker` | Persistent worker | Loads XML once, reads jobs from stdin, responds on stdout. Used by Spring Boot in production |
| `--kafka-worker` | Kafka async | Consumes `file-processing-jobs` topic, publishes decoded frames to `can-frames-decoded` |
| `--metadata` | Metadata only | Fast first/last timestamp extraction without full parse |

### XML loading (`load_xml_files`)
- Parses `<massage>` elements (intentional spelling — matches the actual XML schema)
- Reads `<Byte>` → `<Signal>` → `<values>` trees
- Builds a `val_map` dict: keys are `int(float(raw))` where possible, string fallback on `ValueError`

### Frame decoding (`decode_frame`)
- Extracts signal value: `(byte_val & mask) >> shift`
- Looks up label in `val_map` — handles both integer and string keys (see Section 13, Fix 2)
- Builds `all_states` dict for the frontend chart y-axis labels
- Reports unknown values to the `ErrorReport` collector

### Anomaly detection
- **Layer 1 — Rule engine** (`anomaly/rule_engine.py`): configurable rules over signal values and inter-frame timing
- **Layer 2 — Statistical** (`anomaly/detector.py`): Isolation Forest, scores each frame; alerts published to Kafka `can-frames-anomalies`

### File format support
- **ASCII** (`.txt`, `.log`, `.asc`): regex-based line parser with DLC mismatch detection
- **BLF** (`.blf`): `python-can` BLFReader with timestamp normalisation and channel coercion

---

## Section 6 — Frontend Structure

```
frontend/src/app/
├── anomaly-panel/
│   ├── anomaly-panel.component.ts   # self-contained: opens own STOMP → /topic/anomalies
│   ├── anomaly-panel.component.html
│   └── anomaly-panel.component.css
├── config/
│   └── api.config.ts                # API_BASE_URL = http://localhost:8082
├── dashboard/
│   ├── dashboard.component.ts       # file upload, batch/stream/async analysis, charts, table
│   ├── dashboard.component.html
│   └── dashboard.component.css
├── interceptors/
│   └── auth.interceptor.ts          # attaches Bearer token; intercepts 401 → redirect /login
├── login/
│   └── login.component.ts           # login + MFA second-factor step
├── profile/
│   └── profile.component.ts         # self-service: username, email, password, MFA, sessions, audit, avatar
├── services/
│   ├── auth.service.ts              # JWT storage, getCurrentUser(), isAdmin(), logout()
│   ├── dashboard-state.service.ts   # persists dashboard state across navigation
│   ├── simulator-state.service.ts   # persists simulator state across navigation
│   └── user-api.service.ts          # all REST calls (users, uploads, sessions, audit, MFA)
├── simulator/
│   ├── simulator.component.ts       # live CAN simulator, decoded frame table, charts, 3D
│   ├── simulator.component.html
│   └── simulator.component.css
├── users/
│   └── users.component.ts           # admin-only user CRUD
└── app.routes.ts                    # route definitions with auth guards
```

### STOMP subscriptions per component

| Component | Topic | Purpose |
|---|---|---|
| Dashboard (batch) | `/topic/batch-frames/{sessionId}` | 60 Hz frame delivery |
| Dashboard (async) | `/topic/async-frames/{sessionId}` | Kafka-pipeline frames |
| Dashboard (async) | `/topic/async-progress/{sessionId}` | progress / done / error events |
| Simulator | `/topic/frames` | live simulated frames |
| Simulator | `/topic/sim-status` | SCENARIO_DONE signal |
| AnomalyPanel | `/topic/anomalies` | real-time anomaly alerts |

---

## Section 7 — Authentication & Security

### JWT flow
1. Client POSTs credentials to `/api/users/login`
2. Server validates, issues a signed JWT (stateless — no server-side session for auth)
3. `authInterceptor` attaches `Authorization: Bearer <token>` to every outgoing request except login/register
4. `JwtAuthenticationFilter` (server-side) extracts and validates the token on every request; bypasses `/ws/**`, `/api/users/login`, `/api/users/login/mfa`, `/api/users/register`

### 401 handling (frontend)
`auth.interceptor.ts` catches any 401 response on non-auth paths, clears `localStorage` (`jwt`, `user_info`), and navigates to `/login`. This prevents stale tokens from silently failing.

### Role-based access (SecurityConfig)

| Endpoint | Restriction |
|---|---|
| `POST /api/users/login`, `/register`, `/forgot-password`, `/reset-password` | Public |
| `GET /api/users/avatars/**` | Public |
| `/ws/**`, `/api/unity/**`, `/api/health/**` | Public |
| `POST /api/analyze`, `/api/analyze-stream`, `/api/analyze/**` | Public |
| `GET /api/users` | `ROLE_ADMIN` |
| `POST /api/users` | `ROLE_ADMIN` |
| `PUT /api/users/{id}` | `ROLE_ADMIN` |
| `DELETE /api/users/{id}` | `ROLE_ADMIN` |
| `GET /api/audit/all` | `ROLE_ADMIN` |
| Everything else | Authenticated |

### MFA
- TOTP-based (time-based one-time password)
- Setup: server generates secret + QR code URL; frontend renders QR via `qrcode` library
- Enable: user submits 6-digit code; server verifies with `MfaService`
- Disable: requires current password + active TOTP code
- Login flow: standard login returns `mfaRequired: true`; client sends code to `/api/users/login/mfa`

### Password reset
- User requests reset via `/api/users/forgot-password` (email)
- Server generates OTP, stores in `otp_tokens` table, emails it
- User submits token + new password to `/api/users/reset-password`

### BCrypt
All passwords stored as BCrypt hashes. `SecurityConfig` wires `BCryptPasswordEncoder` into the `DaoAuthenticationProvider`.

---

## Section 8 — WebSocket & Real-Time Communication

Spring Boot exposes a STOMP broker at `/ws` (SockJS fallback at `/ws/websocket`).

### Batch mode (default)
1. Client generates a `sessionId` (UUID)
2. Client subscribes to `/topic/batch-frames/{sessionId}` **before** uploading
3. Client POSTs the log file with the `sessionId` to `/api/analyze`
4. Server dispatches a job to the warm Python worker
5. Python writes decoded frames to stdout; Spring Boot batches them at 60 Hz and pushes each batch as `{ frames: [...], done: boolean, errorReport: {...} }` to the session topic

### Async mode (Kafka pipeline)
1. Client POSTs to `/api/analyze/async`; server returns `sessionId`
2. Python kafka-worker consumes `file-processing-jobs`, publishes each frame to `can-frames-decoded`
3. `AsyncAnalysisConsumer` picks frames up and forwards to `/topic/async-frames/{sessionId}`
4. Progress/done/error events go to `/topic/async-progress/{sessionId}`

### SSE streaming mode
- Client POSTs to `/api/analyze-stream`
- Server launches Python in `--stream` mode; reads stdout line-by-line, emits each as an SSE `data:` event
- Frontend reads the body as a stream (`getReader()`) — no WebSocket involved

### Simulator
- `SimulationController` handles STOMP messages on `/app/simulate/start|pause|stop|reset|speed|fault|scenario`
- `SimulationEngine` runs a timer loop, generates frames, publishes to `/topic/frames`
- `SCENARIO_DONE` events sent to `/topic/sim-status`

---

## Section 9 — Kafka Integration

### Topics

| Topic | Producer | Consumer | Purpose |
|---|---|---|---|
| `can-frames-raw` | Spring Boot | Spring Boot | raw frame logging |
| `can-frames-decoded` | Python kafka-worker | `AsyncAnalysisConsumer`, `DecodedFrameKafkaConsumer` | decoded frames → WebSocket |
| `can-frames-anomalies` | Python kafka-worker | `AnomalyKafkaConsumer` | anomaly alerts → `/topic/anomalies` |
| `log-file-events` | Python kafka-worker | `AsyncAnalysisConsumer` | progress / done / error events |
| `file-processing-jobs` | Spring Boot | Python kafka-worker | async job dispatch |
| `session-meta` | Python kafka-worker | — | per-session metadata |

### Consumer groups
- `can-analyzer` — raw frames
- `can-analyzer-decoded` — decoded frames
- `can-analyzer-anomalies` — anomaly alerts
- `can-analyzer-async` — async decoded frames
- `can-analyzer-events` — progress events
- `python-file-workers` — Python kafka-worker

All six consumer groups confirmed joined and partitions assigned on startup.

---

## Section 10 — File Storage

Spring Boot abstracts storage behind a `StorageService` interface with two implementations:

- **`S3StorageServiceImpl`** — uploads to MinIO (S3-compatible). Configured via `S3Config` using AWS SDK. Used when MinIO is running.
- **`LocalStorageServiceImpl`** — stores files on the local filesystem. Fallback when MinIO is unavailable.

Uploaded files are stored under a path derived from the user ID and a UUID. The `UploadRecord` entity tracks filename, path, upload timestamp, and owner. The profile page lists all uploads for the current user and supports one-click re-analysis.

Avatars are stored separately and served via `GET /api/users/avatars/**` (public endpoint, no auth required).

---

## Section 11 — CAN Simulation

The simulator generates synthetic CAN frames using signal definitions loaded from the same XML files used by the parser.

### Scenarios

| Scenario | Frames | Description |
|---|---|---|
| `RANDOM` | ∞ | Continuous random valid signal values |
| `KEY_APPROACH` | 8 | Simulates key fob approaching vehicle |
| `ALL_DOORS_OPEN` | 8 | All door latch signals transition to open |
| `FULL_SEQUENCE` | 12 | Complete key approach + door sequence |

### Fault injection (runtime, toggle during running simulation)

| Fault | Rate | Effect |
|---|---|---|
| Value errors | 10% | Corrupts a random signal byte to an invalid value |
| Timing gaps | 5% | Inserts a 2–5 second artificial delay |
| Counter errors | 8% | Duplicates the previous frame counter value |

### Speed multiplier
Frames are generated at 1×, 0.5×, 2×, 5×, or 10× real time. The multiplier is sent to `SimulationEngine` via STOMP `/app/simulate/speed`.

### Frontend simulator page
- TABLE view: decoded frame table with signal rows expanded below each frame (same layout as dashboard)
- CHARTS view: live-updating stepped line charts, grouped by signal state set
- 3D view: forwards frames to Unity via `POST /api/unity/frame`
- Anomaly panel: `AnomalyPanelComponent` mounted at the top of the page, subscribes to `/topic/anomalies`

---

## Section 12 — Anomaly Detection

Anomaly detection runs in the Python parser after each frame is decoded.

### Layer 1 — Rule Engine (`anomaly/rule_engine.py`)
- Evaluates configurable rules: unexpected signal values, inter-frame timing violations, counter discontinuities
- Fires immediately on rule match; no training required
- Publishes alerts with `source: RULE_ENGINE`

### Layer 2 — Isolation Forest (`anomaly/detector.py`)
- Scikit-learn `IsolationForest` fitted on accumulated frame feature vectors
- Scores each frame; anomaly score below threshold triggers an alert
- Publishes alerts with `source: ISOLATION_FOREST`
- **Note:** the model is initialised with a default random seed and refits as data arrives. It has not been trained on a labelled real-world dataset; the anomaly threshold may need tuning before production use.

### Alert delivery
- Alerts are published to Kafka topic `can-frames-anomalies`
- `AnomalyKafkaConsumer` (Spring Boot) consumes and forwards to STOMP `/topic/anomalies`
- `AnomalyPanelComponent` (Angular, standalone) maintains its own STOMP connection and receives alerts on this topic
- Panel displays: severity badge (LOW / MEDIUM / HIGH / CRITICAL), type, frame ID, signal name, detail message, timestamp, source engine
- Present on both Dashboard and Simulator pages

---

## Section 13 — Fixes Applied

### Fix 1 — JavaTimeModule (ObjectMapperConfig.java)
**Problem:** `Instant` / `LocalDateTime` fields serialised as `[seconds, nanos]` numeric arrays. Angular `new Date(value)` failed silently, causing profile timestamps and session dates to show as `Invalid Date`.

**Root cause:** Spring Boot's default `ObjectMapper` had no `JavaTimeModule`, so Jackson fell back to numeric timestamp serialisation.

**Fix:** Added `ObjectMapperConfig.java` using `Jackson2ObjectMapperBuilderCustomizer` (which augments the auto-configured mapper rather than replacing it, preserving Kafka serialisers and MVC message converters):
```java
builder
  .modules(new JavaTimeModule())
  .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
```
Instants now serialise as ISO-8601 strings (`"2026-04-26T19:01:26Z"`).

---

### Fix 2 — parser.py val_map string/integer key mismatch
**Problem:** Signal state lookups returned `Unknown(N)` for all valid values in XML files where the `<value>` text could not be parsed as a float (e.g. leading spaces, unusual formatting). The `val_map` keys were stored as strings in the `except ValueError` fallback path, but `extracted` (result of bit-mask shift) is always an integer — so `extracted in val_map` always failed.

**Root cause:** `load_xml_files` stores keys as `int(float(raw))` when possible, but falls back to the raw string. The lookup in `decode_frame` only tested `extracted in val_map` (integer key).

**Fix** (`python_parser/parser.py`, `decode_frame`):
```python
elif val_map.get(str(extracted)) is not None or extracted in val_map:
    label    = val_map.get(str(extracted)) or val_map.get(extracted)
    is_valid = True
```
Tries the string key first, falls back to integer. The `is not None` guard prevents an empty-string label from being treated as a miss.

---

### Fix 3 — Password change error display (profile.component.ts)
**Problem:** When the backend rejected a password change (e.g. wrong current password), the error toast showed "Failed to change password." regardless of the actual server message.

**Root cause:** The error handler only read `err?.error?.message`, but some Spring Security responses return a plain string body, not a JSON object with a `message` field.

**Fix** (`frontend/src/app/profile/profile.component.ts`):
```typescript
this.passwordError = err?.error?.message
                  ?? (typeof err?.error === 'string' ? err.error : null)
                  ?? 'Failed to change password.';
```
Reads the structured message first, falls back to the raw string body, then falls back to the generic text.

---

### Fix 4 — Auth interceptor 401 redirect (auth.interceptor.ts)
**Problem:** Expired JWT tokens caused API calls to return 401, but the app did not redirect to login — it just showed empty/broken pages.

**Root cause:** No global 401 handler existed. Each component would silently fail on `error` callbacks.

**Fix** (`frontend/src/app/interceptors/auth.interceptor.ts`): Added `catchError` to the interceptor pipe. On any 401 response from a non-auth endpoint, it clears `localStorage` (removes `jwt` and `user_info`) and navigates to `/login`:
```typescript
catchError(err => {
  if (err?.status === 401 && !isAuthSkipPath) {
    localStorage.removeItem('jwt');
    localStorage.removeItem('user_info');
    router.navigate(['/login']);
  }
  return throwError(() => err);
})
```

---

### Fix 5 — hasRole ADMIN on user management endpoints (SecurityConfig.java)
**Problem:** User management endpoints (`GET/POST/PUT/DELETE /api/users`, `GET /api/audit/all`) were either unprotected or only required authentication, not admin role.

**Fix** (`SecurityConfig.java`): Explicit `.hasRole("ADMIN")` rules added before the catch-all `.anyRequest().authenticated()`:
```java
.requestMatchers(HttpMethod.GET,    "/api/users").hasRole("ADMIN")
.requestMatchers(HttpMethod.POST,   "/api/users").hasRole("ADMIN")
.requestMatchers(HttpMethod.PUT,    "/api/users/{id}").hasRole("ADMIN")
.requestMatchers(HttpMethod.DELETE, "/api/users/{id}").hasRole("ADMIN")
.requestMatchers(HttpMethod.GET,    "/api/audit/all").hasRole("ADMIN")
```

---

### Fix 6 — Simulator decoded frame table (simulator.component.ts)
**Problem:** The simulator table showed raw byte arrays only. Signal names and decoded values were never displayed.

**Root cause:** `mapFrame()` read from `f.parsed_signals` (a non-existent array field). The backend sends frames with `f.signals` (a dict keyed by signal name), same format as the parser output.

**Fix:** Rewrote `mapFrame()` to iterate `Object.entries(f.signals ?? {})` and build `parsedSignals` from the dict — matching the dashboard's `parseSignalsFromRaw` logic:
```typescript
const rawSignals: Record<string, any> = f.signals ?? {};
for (const [sigName, sigData] of Object.entries(rawSignals)) {
  parsedSignals.push({
    name:    sigName,
    value:   String(s?.label ?? s?.raw_value ?? '-'),
    rawVal:  s?.raw_value ?? 0,
    isValid: s?.is_valid !== false,
    allStates,
  });
}
```
Also added `ViewChild`, `autoScroll`, `onTableScroll()`, `resumeAutoScroll()`, `scrollToBottom()`, and the `#framesWrap` binding for live auto-scroll with a "↓ Live" pill.

---

### Fix 7 — Anomaly panel wired into simulator page
**Problem:** The simulator page had no anomaly alerts UI even though the backend publishes alerts to `/topic/anomalies` during simulation.

**Fix:** Added `AnomalyPanelComponent` to the simulator's `imports` array and placed `<app-anomaly-panel>` as the first element in `simulator.component.html`. The panel is self-contained — it manages its own STOMP connection internally.

---

## Section 14 — Known Issues

### Unity 3D integration
- The `POST /api/unity/frame` endpoint is implemented and the Angular UI exposes replay/live controls.
- End-to-end testing with a running Unity scene has not been completed.
- The Unity endpoint is `permitAll()` — no auth check — which is intentional for the Unity client but should be noted.

### Anomaly detection model quality
- The Isolation Forest is initialised with defaults and refits online as frames arrive.
- It has not been trained on a labelled real-world CAN dataset.
- False positive/negative rates are unknown. The anomaly threshold in `detector.py` may need tuning before relying on it in a real vehicle security context.

### Maven wrapper download on first run
- `./mvnw spring-boot:run` attempts to download Maven 3.9.14 from Maven Central.
- On restricted networks this fails with a `curl` error.
- **Workaround:** Maven 3.9.14 is cached at `C:\Users\acer\.m2\wrapper\dists\apache-maven-3.9.14-bin\`. Use the binary directly:
  ```
  C:\Users\acer\.m2\wrapper\dists\apache-maven-3.9.14-bin\<hash>\apache-maven-3.9.14\bin\mvn spring-boot:run
  ```

---

## Section 15 — Current Status (as of 2026-04-26)

### Confirmed working
- Spring Boot starts on port 8082 in ~9 seconds; all 5 Kafka consumer groups join successfully
- Angular compiles and serves on port 4200 (one non-critical NG8107 warning in profile template)
- Docker: Kafka, PostgreSQL, MinIO all start from `docker-compose.yml`; InfluxDB is not used
- Login / register / logout
- JWT auth with Bearer token on all protected endpoints
- 401 → automatic redirect to `/login`
- MFA enable / disable via TOTP
- Password reset via email OTP
- User CRUD restricted to `ROLE_ADMIN`
- Audit log (own entries for all users; all entries for ADMIN)
- Session list and revoke
- Avatar upload and display
- Profile page: username/email inline edit, password change with correct error messages
- File upload: `.txt`, `.log`, `.asc`, `.blf` all accepted
- Batch analysis (WebSocket 60 Hz) with decoded frame table + signal expansion
- Stream analysis (SSE) with live frame delivery
- Async analysis (Kafka pipeline) with per-session progress events
- Signal state lookup: both integer and string XML keys now resolve correctly (parser.py fix)
- ISO-8601 date serialisation (JavaTimeModule fix)
- Dashboard: table view, chart view (grouped + separate), export JSON, error report download
- Simulator: start / pause / stop / reset, speed multiplier, scenario picker, fault injection
- Simulator: decoded frame table with live auto-scroll and "↓ Live" pill
- Simulator: charts view with live-updating stepped line charts
- Anomaly panel visible on both Dashboard and Simulator pages

### Remaining / not yet fully verified
- Unity 3D replay and live-forward (frontend controls exist; Unity scene not tested end-to-end)
- Anomaly detection accuracy (rule engine fires correctly; Isolation Forest threshold not tuned)
- Email delivery for password reset (depends on SMTP configuration in `application.properties`)
- MinIO integration under load (single-file uploads tested; large file / concurrent upload not stress-tested)
- `python` vs `python3` PATH on Windows (see Section 17)

---

## Section 16 — Running the Project

### Prerequisites
- Docker Desktop running
- Java 17 (JDK, on PATH or `JAVA_HOME` set)
- Node.js 18+ and `npm`
- Python 3.10+ with `pip`

### 1. Start infrastructure
```bash
cd C:\Users\acer\Desktop\pfemolka
docker-compose up -d
```
Expected containers: `smart-analyzer-kafka`, `smart-analyzer-postgres`, `smart-analyzer-minio`.

### 2. Install Python dependencies
```bash
cd python_parser
pip install -r requirements.txt
```

### 3. Start Spring Boot
```bash
cd smart-analyzer-backend

# If mvnw download fails, use the cached Maven directly:
C:\Users\acer\.m2\wrapper\dists\apache-maven-3.9.14-bin\1cb7fhup6b5n3bed6kckbrnspv\apache-maven-3.9.14\bin\mvn spring-boot:run
```
Wait for: `Started SmartAnalyzerBackendApplication in X seconds`

### 4. Start Angular
```bash
cd frontend
npm install        # first time only
npx ng serve
```
Wait for: `Local: http://localhost:4200/`

### 5. Verify
- Open `http://localhost:4200`
- Login or register
- Upload a `.txt` / `.blf` CAN log file on the Dashboard
- Click Analyze — frames should appear in the table with signals expanded

---

## Section 17 — Common Issues & Troubleshooting

### Port 8082 already in use
```powershell
netstat -ano | findstr :8082
# note the PID, then:
Stop-Process -Id <PID> -Force
```

### Spring Boot fails with "Python worker stopped" immediately
The `AnalysisService` launches Python on startup. Check:
- `python` is on PATH (Windows uses `python`, not `python3` — see below)
- The `python_parser/` directory exists relative to the working directory
- `requirements.txt` packages are installed

### `python` vs `python3` on Windows
On Windows, the Python executable is typically `python` (not `python3`). If `AnalysisService` is configured to call `python3`, the worker will fail to start. Check `application.properties` or `AnalysisService.java` for the Python command and change `python3` → `python` if needed.

### Maven wrapper download fails (restricted network)
See Section 14. Use the cached binary at:
```
C:\Users\acer\.m2\wrapper\dists\apache-maven-3.9.14-bin\1cb7fhup6b5n3bed6kckbrnspv\apache-maven-3.9.14\bin\mvn
```

### Angular NG8107 warning in profile template
```
The left side of this optional chain '?.' does not include null/undefined
```
This is a non-blocking compile warning on `profile.component.html:444` (`me?.mfaEnabled`). The build succeeds and the app works normally. Safe to suppress with a `// @ts-ignore` or to replace `?.` with `.` on that line.

### Kafka consumers not joining (partitions not assigned)
- Ensure `smart-analyzer-kafka` is fully healthy before Spring Boot starts: `docker ps` should show `(healthy)` not `(health: starting)`
- If Spring Boot started before Kafka was ready, restart Spring Boot

### CORS error in browser console
Allowed origin is hardcoded to `http://localhost:4200`. If Angular runs on a different port, update `SecurityConfig.corsConfigurationSource()`.

### MinIO 403 on avatar upload
The `smart-analyzer-minio` container must be running and the configured bucket must exist. Check MinIO console at `http://localhost:9001` (credentials in `application.properties`).

### BLF files not decoded
`python-can` must be installed: `pip install python-can`. Without it, the `--blf` branch raises `RuntimeError` and the analysis fails.

---

## Section 18 — Next Steps

1. **Unity 3D end-to-end test** — open the Unity scene, run the simulator or replay a real log, verify vehicle model responds to door/chassis signals.

2. **Anomaly model tuning** — collect real CAN logs with labelled normal/anomalous frames, retrain the Isolation Forest, set a calibrated contamination factor.

3. **Email SMTP configuration** — configure `spring.mail.*` properties so password-reset OTP emails actually deliver in the target environment.

4. **MinIO bucket provisioning** — automate bucket creation on first start (currently requires manual setup via MinIO console or mc CLI).

5. **Test coverage** — add Spring Boot integration tests for the analysis pipeline (warm worker → decoded frames → WebSocket delivery) and Angular component tests for the frame table and chart rendering.

6. **Docker Compose profiles** — add a `python-worker` service so the Python parser can be containerised alongside the Java backend, eliminating the manual `pip install` step.

7. **Report packaging** — export the decoded frame table and error report as PDF directly from the Angular UI (currently only JSON export is implemented).

8. **Multi-file batch** — allow uploading multiple log files in one session and analysing them sequentially with a combined signal timeline.
