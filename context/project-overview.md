# KPIT Smart Real-Time CAN Analyser

## Overview
KPIT Smart Real-Time CAN Analyser is a full-stack web platform for capturing,
decoding, storing, visualizing, and analysing CAN Bus data from vehicle ECUs
in real time. It is designed for automotive engineers and embedded systems
developers who need to monitor live CAN traffic, inspect decoded signals,
detect integrity violations, and replay recorded sessions — without the cost
or hardware dependency of traditional tools like Vector CANalyzer. The platform
combines a Python CAN pipeline, a Spring Boot backend, an Angular frontend,
and an AI anomaly detection engine, enriched with a real-time 3D digital twin
of the vehicle rendered in Unity.

## Goals
1. Let authenticated users capture, decode, and store CAN Bus frames from a 
   live simulator or uploaded log file (.asc, .blf) within 2 seconds of session start.
2. Stream decoded CAN signals to the browser in real time via WebSocket STOMP
   with a maximum latency of 100ms and zero frame loss at 10Hz simulation frequency.
3. Let users replay any completed CAN session from InfluxDB with precise 
   timestamp ordering, configurable playback speed (0.1x to 4x), and seek control.
4. Automatically detect CAN protocol violations — timing gaps, counter errors, 
   and signal range violations — on every incoming frame and surface them as typed, 
   timestamped fault entries linked to their session and frame.
5. Let an ML anomaly engine (IsolationForest) score every decoded frame and flag 
   contextual anomalies that pass static catalog rules but deviate statistically 
   from learned ECU behavior patterns.
6. Let authenticated admins upload, reload, and delete XML ECU catalog files from 
   the browser — with the decoder applying the new catalog immediately without backend restart.
7. Let users upload CAN log files up to 200MB and process them asynchronously via a 
   streaming parser that never loads the full file into memory — preventing Python p
   rocess crashes on 2-hour sessions.
8. Animate a 3D Unity vehicle model in real time driven by live CAN signal values — 
   mapping door signals to door animations, RPM to wheel rotation, and headlight 
   signals to light activation — within 200ms of signal change.
9. Let users query CAN session data in plain French or English and receive   
   correct filtered results translated automatically into SQL or InfluxDB Flux by an LLM.
10. Generate a structured PDF report summarizing faults, anomaly clusters, 
   and ECU behavior for any completed session — automatically, within 30 seconds of session end, via LLM.

   

## Core User Flow
1. User signs in with email and password — MFA verification if enabled
2. User navigates to the CAN Workspace and selects or creates a session
3. User starts the CAN simulator (or uploads a log file) from the workspace
4. Raw CAN frames are generated → published to Kafka → decoded by Python →
   persisted to MySQL and InfluxDB → streamed via WebSocket to the browser
5. User sees live signal charts updating in real time, grouped by CAN message
6. User monitors the 4-stage pipeline counter (Simulator → WebSocket →
   MySQL → InfluxDB) to verify data flow
7. User applies filters (Message ID, Bus, Faults Only, Anomaly Only) to
   narrow down the frame table
8. User stops the simulator — session status changes instantly from LIVE
   to COMPLETE via WebSocket notification
9. User clicks Play on a completed session to replay it from InfluxDB with
   configurable speed (0.1x to 4x)
10. User opens the Integrity tab to view all detected faults (timing gaps,
    counter errors, signal range violations) for the session
11. User exports the frame table as CSV for offline reporting
12. Admin uploads a new XML ECU catalog via the Catalog Management page —
    the decoder hot-reloads without backend restart
13. Admin manages the vehicle fleet — creates cars, links sessions to vehicles
14. AI engine scores each frame for anomalies — user sees red anomaly badges
    in the frame table and grouped alerts in the Integrity tab
15. 3D vehicle model in Unity animates in sync with live CAN signals —
    doors open, headlights activate, wipers move

## Features

### Live CAN Simulation
- Python simulator generates realistic CAN frames at 1–20 Hz configurable
  from the UI slider
- Two modes: Random (catalog-driven random valid values) and Replay (from
  a previously recorded log file)
- Fault injection: timing gaps, counter sequence errors, signal range
  violations — configurable fault rate 1%–50%
- Simulator controlled from the workspace UI — start, stop, configure
  frequency and fault rate without leaving the page
- Car/vehicle linking — simulated sessions can be associated with a specific
  vehicle in the fleet

### Real-Time Frame Decoding
- Python decoder consumes raw CAN frames from Kafka topic raw-can-frames
- Decodes bytes using XML ECU catalogs — maps bit positions to signal names
  and human-readable value labels
- Publishes decoded frames to Kafka topic decoded-signals
- Unknown message IDs are flagged as UNKNOWN ECU and still persisted
- Supports 6 XML catalogs: powertrain, chassis, car, key, body, adas

### Kafka Message Pipeline
- Apache Kafka 3.8 in KRaft mode (no ZooKeeper dependency)
- 4 topics: raw-can-frames, decoded-signals, session-meta,
  file-processing-jobs
- Manual offset commit — no data loss on consumer crash
- 16ms batch broadcast windows for WebSocket performance

### Dual Database Storage
- MySQL 8: sessions, frames (with signals as JSON), integrity faults,
  users, fleet, ECU catalog metadata
- InfluxDB 2.7: one time-series point per signal per frame — tagged by
  session_id, signal_name, msg_id, channel_name
- Batch writes to InfluxDB (500 points / 100ms) for 5x throughput
- Full cascade delete — removing a session cleans MySQL + InfluxDB +
  integrity faults + log file on disk

### Real-Time WebSocket Streaming
- STOMP protocol over SockJS
- Topics: /topic/frames/{sessionId} (live frames), /topic/sessions
  (status changes), /topic/playback/{sessionId} (replay points)
- Frames batched in 16ms windows to balance throughput and latency
- COMPLETE notification broadcast instantly on simulator stop

### Session Management
- Every simulation or file upload creates a named session with UUID,
  source, timestamps, frame count, status, and vehicle link
- LIVE/COMPLETE badges updated in real time via WebSocket
- Filter sessions by vehicle, message ID, bus/channel, faults, anomalies
- Deep linking — session ID persisted in URL query params
- Full cascade delete with confirmation

### Log File Upload
- Supported formats: .asc (ASCII), .blf (Binary Logging File), .log, .txt
- Asynchronous processing via Kafka file-processing-jobs topic and
  Python file_worker.py
- Streaming parser (parse_log_stream) — never loads all frames into memory
  at once — safe for 2h+ log files
- Upload linked to a specific vehicle via carUid parameter
- Status polling every 2 seconds until complete or error
- Inline upload panel in workspace — no page navigation required

### Signal Chart Visualization
- Chart.js step-line charts grouped by CAN message
- Live mode: RAF loop at 30fps, 50ms throttle, live ticker extends lines
  at 200ms intervals
- Replay mode: InfluxDB stream → sort by timestamp → playback clock at
  16ms interval → feed Chart.js
- Replay controls: Play / Pause / Seek / Speed (0.1x to 4x)
- Stepped rendering appropriate for discrete CAN signal state values

### Frame Table
- Paginated table with relative timestamps from session start (0.000s)
- Filters: Message ID, Bus/Channel, Faults Only, Anomaly Only
- Fault badges: ⚠ on frames with integrity violations
- Anomaly badges: 🔴 on frames scored above threshold by ML engine
- CSV export with Bearer token authentication

### Integrity Analysis
- Automatic fault detection on every incoming frame in real time
- Timing gap detection: frame arrived outside expected cycle time defined
  in XML catalog Cyclic/cycle field
- Counter error detection: frame_seq sequence number gaps
- Signal range violation: signal value not in catalog valid value set
- Fault summary per session + detailed fault list in Integrity tab
- Faults stored in integrity_faults MySQL table with session and frame link

### ML Anomaly Detection
- IsolationForest model trained on normal CAN session patterns
- Scores every frame 0.0 (normal) to 1.0 (anomaly)
- Detects contextual anomalies beyond static range rules — e.g. a value
  valid per catalog but statistically abnormal given current vehicle context
- Detects timing drift anomalies — silence between frames even when
  signal values are all within range
- Scores computed asynchronously in a dedicated Kafka consumer — never
  blocks the main pipeline
- Anomaly score and badge stored per frame in MySQL
- Grouped anomaly cluster alerts in Integrity tab

### ECU Catalog Management
- XML catalog files define message IDs, signal names, bit positions,
  cycle times, and valid value maps for each CAN bus
- Admin UI: list all catalogs, view message/signal tree, upload new XML,
  delete catalog, reload without backend restart
- Auto-sync: existing XML files synced to ecu_catalogs MySQL table on
  startup via @PostConstruct
- Catalog hot-reload: CatalogLoaderService reloads in-memory maps without
  restarting Spring Boot

### Fleet Management
- Vehicle registry with make, model, year, VIN, color, virtual flag,
  and active/deleted status
- Soft delete — vehicles marked deleted_at, not physically removed
- Sessions linked to vehicles via carId FK
- View all sessions for a specific vehicle
- Virtual vehicles for simulator-only use (no VIN required)

### User Management & Security
- JWT-based stateless authentication with refresh tokens
- MFA/TOTP — time-based one-time password via authenticator app
- RBAC — Role-Based Access Control with Admin and User roles
- Spring Security 6 protecting all REST endpoints
- Angular route guards protecting frontend pages
- Audit logging for sensitive admin actions
- Rate limiting via Bucket4j to prevent API abuse
- Path traversal, auth bypass, and InfluxDB injection vulnerabilities
  resolved in Sprint 5

### 3D Digital Twin 
- Unity 2022 LTS renders an interactive 3D vehicle model in the browser
- Model built and optimized in Blender 4.x, exported as GLB
- Each CAN signal maps to a vehicle animation: door signals → door open/
  close, RPM → wheel rotation speed, headlight signal → lights on/off,
  wiper signal → wiper movement
- Unity consumes the same live WebSocket STOMP stream as Angular — no
  additional server required
- C# STOMP bridge bridges Spring Boot to Unity in real time

### Natural Language Query 
- User types a query in plain French or English: "show me sessions on the
  chassis bus with more than 10 counter errors"
- LLM translates the intent automatically into SQL or InfluxDB Flux query
- Results displayed directly in the session or frame table

### Auto Summarisation 
- After each session completes, the LLM Summariser receives session
  statistics — frame count, fault summary, anomaly clusters, ECUs involved
- Generates a 3–5 paragraph professional PDF report automatically
- Report includes: session overview, detected faults, anomaly analysis,
  recommended actions

### Audit Management
- Every sensitive action performed on the platform — login attempts, role
  changes, catalog uploads, session deletions, and user management — is
  automatically recorded as a timestamped audit log entry.
- Administrators can view the full audit log across all users — filterable
  by user, action type, and date range.
- Each user can view their own audit history only — they cannot see the
  actions of other users.
- Audit records are read-only — they cannot be edited or deleted by any role.

### ECU Catalog Templates
- A curated library of prebuilt XML ECU catalog files covering the main
  CAN bus domains found in modern vehicles.
- Users can import any catalog into the platform at any point — before
  starting a simulation or uploading a log file.
- Catalogs are static XML snapshots loaded directly into the decoder and
  integrity analyzer on import, with no backend restart required.
- Covers the most common automotive bus domains: powertrain (engine, RPM,
  throttle), chassis (brakes, steering, suspension), body (doors, lights,
  wipers, climate), ADAS (collision warning, lane assist, adaptive cruise,
  parking, driver monitoring), key, and car control.

### AI Session Analysis
- AI analyses a completed CAN session from a user-supplied context or
  automatically after session end.
- Output is structured as a typed fault summary, anomaly cluster report,
  and ECU behavior breakdown written directly into the session report.
- Analysis runs as an asynchronous background task via a dedicated Kafka
  consumer — never blocking the live frame pipeline or the UI.

### AI Anomaly Detection
- An ML model (IsolationForest for tabular frames, Autoencoder for
  sequential signal drift) is trained offline on stored InfluxDB sessions
  and learns what normal ECU behavior looks like beyond static catalog rules.
- Inference runs inside a dedicated Python Kafka consumer on every incoming
  decoded frame — the result is an anomaly_score field (0.0 normal to 1.0
  anomaly) stored per frame in MySQL.
- Detects contextual anomalies invisible to rule-based checks — a signal
  value technically within catalog range but statistically abnormal given
  the current combination of vehicle speed, throttle position, and ECU
  family behavior.
- The Integrity tab exposes a threshold slider — engineers adjust the
  sensitivity — and the frame table shows a red anomaly badge and score
  bar on flagged frames.
- Scoring runs asynchronously in a separate Kafka consumer group — never
  blocking the live frame persistence pipeline or the WebSocket broadcast.

### Session Report Generation
- The completed session data — frames, faults, anomaly scores, and ECU
  behavior patterns — is converted into a structured PDF technical report.
- Reports are persisted as files on disk and linked to the session record
  in the database.
- Users can view and download the generated report from the session page.

### ECU Behaviour Clustering
- Instead of asking "what happened in session X", this feature asks "which
  vehicles or ECUs behave like each other, and which ones are outliers?"
- A feature vector is extracted per session — average message frequency per
  ID, signal variance, fault rate, timing jitter — and k-means or DBSCAN
  clustering is run across all sessions in MySQL.
- Output is a cluster map grouping ECUs that communicate similarly — useful
  for validating firmware updates by immediately detecting if an updated
  ECU's communication fingerprint has drifted from its fleet siblings.

### Signal Importance Ranking
- When an anomaly or integrity fault fires, this feature answers which
  signals actually caused or most strongly predicted it.
- SHAP (SHapley Additive exPlanations) values are computed on top of the
  anomaly detection model and returned as a ranked contribution list —
  e.g. "engine_coolant_temp contributed 42%, throttle_position 31%,
  vehicle_speed 18%."
- The Integrity tab displays a ranked signal list with contribution bars —
  collapsing a 100-signal session into the 3–5 signals the engineer
  actually needs to investigate.

### Drive Pattern Classification
- A lightweight classifier (Random Forest) reads aggregate session
  statistics — average and peak RPM, vehicle speed histogram, brake
  pressure events, throttle activity — and labels each session as Idle,
  Urban, Highway, or Aggressive.
- The drive pattern label is stored in MySQL session metadata and displayed
  as a badge in the session list alongside the existing LIVE/COMPLETE badges.
- In the fleet view it becomes a filter dimension — "show me all highway
  sessions for Vehicle #4 in the last month" — and improves anomaly
  detection accuracy by giving the model driving context.

### Smart Log File Triage
- When a large .asc or .blf file is uploaded, a sliding window classifier
  pre-processes the file inside the Python file worker and scores each
  10-second window for fault likelihood.
- Output is a ranked list of points of interest — timestamps ordered by
  how anomalous that window appears — injected into the replay seek bar
  in Angular as visual markers, similar to chapter markers in a video player.
- Engineers click a marker and jump directly to the most fault-rich segment
  of the session — reducing investigation time from hours to minutes on
  4-hour log files.

### AI Architecture Generation
- AI generates an initial CAN analysis pipeline architecture from a
  user-supplied natural language prompt — e.g. "show me sessions on the
  chassis bus with counter errors above 10".
- Output is structured as a typed SQL or InfluxDB Flux query written
  directly into the session filter and frame table.
- Generation runs as an asynchronous background task via a dedicated LLM
  call — never blocking the live frame pipeline or the UI.

### Spec Generation
- The current session data — decoded signals, integrity faults, anomaly
  clusters, and ECU behavior breakdown — is converted into a structured
  Markdown technical specification.
- Specs are persisted as files on disk and linked to the session record
  in the database.
- Users can view and download the generated spec from the session page.

## Scope

### In Scope
- Full-stack web platform: Angular 21 frontend + Spring Boot 3.4 backend
- Python CAN pipeline: simulator, decoder, file worker
- Kafka 3.8 KRaft message broker (Docker)
- MySQL 8 relational storage (native Windows service)
- InfluxDB 2.7 time-series storage (Docker)
- WebSocket STOMP real-time streaming to browser
- XML-based ECU catalog management
- Integrity fault detection (timing, counter, range)
- ML anomaly detection with IsolationForest
- InfluxDB replay with playback controls
- Log file upload (.asc, .blf, .log, .txt)
- Vehicle fleet management
- User management with JWT + MFA + RBAC
- CSV export of frame data
- 3D Unity digital twin driven by live CAN signals
- Natural language query via LLM
- Automatic PDF session report generation via LLM
- Single developer workstation deployment (Windows 11)
- Docker Compose full-stack deployment for production

### Out of Scope
- Real physical CAN hardware interface (USB-CAN adapter, PEAK, Vector)
  — simulator only for this PFE scope
- DBC file format support — only custom XML catalog format is supported
- Mobile-responsive UI — desktop browser only
- Multi-tenant SaaS deployment — single organization
- Real-time collaboration (multiple users editing the same session)
- Cloud deployment (AWS, Azure, GCP) — Docker Compose local only
- CAN FD (Flexible Data-rate) protocol — classic CAN only
- LIN, FlexRay, or Automotive Ethernet protocols
- OBD-II diagnostic protocol
- Per-vehicle or per-session catalog scoping — catalogs are global
- GDPR compliance or data privacy certification
- Paid licensing or commercial distribution

## Success Criteria
1. A signed-in user can start the CAN simulator, see live decoded signal
   charts in under 2 seconds, and stop it — session status changes from
   LIVE to COMPLETE instantly without page refresh
2. A user can upload a 2-hour .blf CAN log file without the Python
   process running out of memory — processed via streaming parser
3. The integrity analyzer detects and stores timing gap, counter error,
   and range violation faults on at least 95% of injected faults during
   testing with 30% fault rate
4. The ML anomaly engine scores a frame as anomalous when its signal
   value is statistically abnormal in context — even if the value is
   within the catalog valid range
5. An admin can upload a new XML ECU catalog and the decoder uses it
   immediately without restarting the backend
6. The InfluxDB replay of a 2-hour session starts in under 5 seconds
   and plays back smoothly at all speeds (0.1x to 4x)
7. The 3D Unity vehicle model animates correctly within 200ms of a CAN
   signal state change — doors open, lights activate, wheels rotate
8. A user can type a plain-language query and receive correct filtered
   session or frame results via the NL Query module
9. The LLM Summariser generates a coherent PDF report within 30 seconds
   of a session completing
10. The full stack starts successfully with a single Docker Compose
    command on a clean machine with no manual configuration