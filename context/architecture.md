# Architecture Context — KPIT Smart Real-Time CAN Analyser

## Stack

| Layer          | Technology                          | Role                                                                 |
| -------------- | ----------------------------------- | -------------------------------------------------------------------- |
| Frontend       | Angular 21 Zoneless + TypeScript    | SPA — reactive UI, signal charts, session management, replay controls |
| Styling        | Tailwind CSS 3.x                    | Utility-first styling — no custom CSS files                          |
| State          | Angular Signals + @ngrx/signals     | Reactive global state — session, filters, pipeline counter           |
| Charts         | Chart.js + RAF loop                 | Real-time step-line signal visualization at 60fps                    |
| WebSocket      | RxStomp / SockJS                    | STOMP client — receives live frames, session events, replay points   |
| Backend        | Spring Boot 3.4.1 + Java 17 (JBR)  | REST API, WebSocket STOMP broker, Kafka consumer, business logic     |
| Auth           | Spring Security 6 + JWT + MFA/TOTP | Stateless authentication, role-based access control, OTP codes       |
| Message Broker | Apache Kafka 3.8 KRaft              | Decoupled event pipeline — 4 topics, no ZooKeeper dependency         |
| Relational DB  | MySQL 8 + Spring Data JPA           | Sessions, frames, faults, users, fleet, catalog metadata             |
| Time-Series DB | InfluxDB 2.7                        | Signal data points for replay and chart queries                      |
| Pipeline       | Python 3.12 + confluent-kafka       | CAN simulator, frame decoder, log file worker, ML anomaly scorer     |
| ML             | scikit-learn (IsolationForest)      | Per-frame anomaly scoring in a dedicated Kafka consumer              |
| LLM            | GPT / Claude API                    | Natural language query translation, PDF session report generation    |
| 3D Twin        | Unity 2022 LTS + Blender 4.x        | Real-time vehicle model animated by live CAN signals via C# STOMP    |
| Infrastructure | Docker Compose                      | Kafka + InfluxDB containerization — single-command startup           |
| Build          | Maven 3.x + Node.js 20+            | Java build automation + Angular dev server and bundler               |

## System Boundaries

- `backend/src/main/java/com/example/backend/can/` — owns all CAN domain logic: session lifecycle, frame persistence, integrity analysis, InfluxDB writes, Kafka consumption, catalog loading, playback, and log upload orchestration
- `backend/src/main/java/com/example/backend/security/` — owns all authentication and authorization: JWT filter chain, MFA/TOTP verification, RBAC enforcement, refresh token rotation, and audit logging
- `Frontend_angular/src/app/features/` — owns all page-level UI: workspace, sniffer, catalogs, fleet, dashboard — each feature is self-contained with its own components and local state
- `Frontend_angular/src/app/core/services/` — owns all cross-feature infrastructure: LiveTelemetryService (WebSocket), ReplayEngineService (playback clock), and API base URL config
- `Frontend_angular/src/app/shared/` — owns reusable layout and UI primitives: sidebar, navbar, badges, spinners — no business logic allowed here
- `python_parser/` — owns the full CAN data pipeline: frame generation (can_simulator.py), signal decoding (decoder.py), log file processing (file_worker.py), ML scoring (anomaly_scorer.py), and XML catalog parsing (xml_decoder.py)
- `python_parser/catalogues/` — owns the ECU catalog source of truth: all XML files defining message IDs, signal names, bit positions, cycle times, and valid value maps
- `uploads/` — owns all uploaded binary artifacts: raw CAN log files and generated PDF session reports — no business logic, no database records stored here directly

## Storage Model

- **MySQL 8**: sessions (lifecycle metadata, status, car link), frames (decoded signals as JSON, timestamps, channel), integrity faults (typed violations linked to session and frame), users (credentials, roles, MFA state), fleet (vehicle registry with soft delete), ECU catalog metadata (filename, bus name, active flag — not the XML content itself), log file records (upload status, format, frame count), refresh tokens, OTP codes, audit logs
- **InfluxDB 2.7**: one time-series point per signal per decoded frame — tagged by session_id, signal_name, msg_id, msg_name, channel_name — used exclusively for replay Flux queries and signal chart streaming — never queried for relational data
- **Filesystem (uploads/)**: raw uploaded CAN log files (.asc, .blf, .log, .txt) and LLM-generated PDF session reports — linked to MySQL records by filename — never stored as BLOBs in the database
- **Filesystem (python_parser/catalogues/)**: XML ECU catalog files — the source of truth for decoding — MySQL ecu_catalogs table stores only metadata, never the XML content itself
- **Kafka topics**: transient in-flight data only — not a storage layer, not a source of truth — data is consumed and immediately persisted downstream
  - `raw-can-frames` — raw frames from the simulator or file_worker, consumed by decoder.py
  - `decoded-signals` — decoded frames from decoder.py, consumed by CanKafkaConsumer (Spring Boot, group `kpit-backend`) and anomaly_scorer.py (group `anomaly-scorer-group`)
  - `session-meta` — session lifecycle events (LIVE, COMPLETE) from simulator/file_worker, consumed by CanKafkaConsumer
  - `file-processing-jobs` — upload jobs from Spring Boot, consumed by file_worker.py
  - `anomaly-events` — anomaly scoring results from anomaly_scorer.py — session_id, msg_id, anomaly_score, threshold, signals_flat — consumed by downstream alert or storage services

## Auth and Access Model

- Every user authenticates via email and password — JWT access token issued on successful login, stored client-side, sent as Bearer header on every API request
- MFA/TOTP is optional per user — when enabled, a time-based one-time password from an authenticator app is required after password verification before a token is issued
- Access tokens expire after a short window — refresh tokens rotate on each use and are stored in MySQL — a compromised refresh token is invalidated on next rotation
- Every request to a protected endpoint is validated by the JWT filter before any controller logic runs — the filter rejects expired, malformed, or missing tokens with 401
- Two roles exist: USER and ADMIN — roles are embedded in the JWT and enforced by Spring Security method-level annotations and Angular route guards
- USER role: read and write access to sessions, frames, fleet (read), catalogs (read), upload, replay, export — cannot manage users, roles, or delete catalogs
- ADMIN role: all USER permissions plus user management, role assignment, catalog upload/delete/reload, audit log access, and system health monitoring
- Every mutating API call verifies the caller's role before executing — the client never self-reports its role — the server reads it from the verified JWT only
- Ownership is not enforced at the resource level — all authenticated users of the same role share access to sessions and fleet within the platform

## Invariants

1. The Kafka consumer (CanKafkaConsumer) never blocks — InfluxDB write failures, integrity analysis errors, and WebSocket broadcast failures are caught and logged independently; a failure in one must never prevent the others from executing
2. The Python file worker never loads all frames from a log file into memory at once — parse_log_stream() with a generator must always be used; parse_log() that returns a full list is forbidden in production code paths
3. The Angular frame table never fetches all frames for a session in a single request — pagination (page + size) is always enforced; loading unbounded frame sets into browser memory is forbidden regardless of session size
4. The ML anomaly scorer runs in a separate Kafka consumer group from the main frame pipeline — anomaly scoring latency never delays frame persistence, WebSocket broadcast, or integrity analysis
5. JWT secrets, database passwords, InfluxDB tokens, and LLM API keys are never committed to the repository — they are read exclusively from environment variables at runtime; the application must fail to start if required secrets are missing rather than falling back to defaults
6. All session deletions are cascaded in order: MySQL frames → MySQL integrity faults → MySQL log file record → InfluxDB points → file on disk — partial deletion is not acceptable; each step is logged and any failure is surfaced as an error, not silently skipped
7. ECU catalog XML files are the single source of truth for signal decoding — the decoder, integrity analyzer, and simulator all read from the same catalog files; signal definitions are never duplicated or hardcoded in Java or Python business logic
8. WebSocket frame broadcasts are always batched through a 16ms buffer window — individual per-frame WebSocket sends are forbidden; unbatched broadcasts would overwhelm connected clients at high simulation frequencies