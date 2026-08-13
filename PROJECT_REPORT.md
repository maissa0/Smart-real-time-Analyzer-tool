# KPIT Smart Real-Time CAN Analyser
## Technical Project Report — PFE Internship
### KPIT Technologies | 2026

**Project name:** KPIT Smart Real-Time CAN Analyser

**Subtitle:** A Full-Stack Automotive CAN Bus Analysis Platform

**Institution:** KPIT Technologies

**Type:** PFE (Projet de Fin d'Études) Internship Project

**Year:** 2026

## Executive Summary

The Controller Area Network (CAN) is the de facto multiplexed backbone wiring contemporary ECUs carrying safety-critical state that remains opaque hexadecimal until OEM XML catalogs supply meaning. Established analyzers—including Vector CANalyzer—require hefty licenses, tethered dongles, and workstation isolation, resisting cloud-style collaboration spanning suppliers and KPIT mentorship peers. KPIT Smart Real-Time CAN Analyser is a browser-hosted, JWT-backed stack wiring Angular UX to Spring Boot APIs, Kafka decouplers, Python can_simulator.py/decoder.py ingestion, relational MySQL plus Influx time-series, oscilloscope-inspired Chart.js panes, catalogue/fleet/session governance APIs, catalogue-driven integrity heuristics, asynchronous log uploads mirroring simulated flows, authenticated RBAC auditing, and STOMP WebSocket telemetry. Targets include automotive subsystem engineers regressing integrations, firmware developers diagnosing enumerations, embedded validation crews reconciling fleets with repeatable lab artefacts. Competitive posture intentionally unifies simulation plus fault regimes, deterministic catalog decoding persisted across databases, instantaneous visualization pipelines, consolidated operational UX typically cobbled manually from heterogeneous vendor tooling.

## System Overview

### What is CAN Bus?

The Controller Area Network (CAN) is a multiplexed broadcast bus standardized for robust serial communication among electronic control units. Frames carry arbitration IDs, payloads up to eight data bytes per classical CAN frame, and CRC-checked bitstreams so collisions resolve deterministically and faulty nodes can be isolated.

Modern road vehicles orchestrate disparate suppliers through CAN and CAN-FD backbones—engine management talks to gateways, gateways fan out to chassis modules, and diagnostic testers sit on the same logical fabric—because a shared, low-cost wire pair scales better than discrete point-to-point links.

Operators rarely reason at the byte level alone: payloads pack multiplexed counters, enumerated states, and scaled engineering values decoded only after consulting OEM XML or DBC-style definitions—hence ingestion pipelines translate opaque hex into named signals auditors can correlate with faults and KPIs.

### Platform Goals

- Capture live CAN traffic from a simulator or log file  
- Decode raw frames using XML ECU catalogs  
- Store decoded data in relational + time-series databases  
- Stream data to browser clients in real time via WebSocket  
- Visualize signal behavior as live oscilloscope-style charts  
- Detect integrity violations automatically  
- Manage ECU catalogs, vehicle fleet, and user access  
- Provide 3D vehicle visualization reacting to live signals (in development)  

## Physical Architecture

### Deployment Topology

During development the entire KPIT CAN Analyser stack is co-hosted on one Windows workstation (paths rooted at `C:\tools\Kpit_c\`), keeping iteration loops short and avoiding provisioning friction for interns validating end-to-end stories.

Operational processes split between native JVM and interpreters versus containerized infra: Oracle-compatible MySQL 8 listens on `localhost` for transactional durability, Docker isolates Kafka 3.8 KRaft and InfluxDB 2.7 with published host ports (`9092`, `8086`), Spring Boot occupies `:8080`, the Python `.venv` runs `decoder.py`, `can_simulator.py`, and `file_worker.py`, and Angular’s dev server serves `:4200` for hot UI reloads chosen for classroom-friendly workflows.

Isolation for the streaming backbone and OLTP time-series datastore comes from Compose-managed containers, while relational traffic stays on bare-metal MySQL tuned for transactional latency on the workstation SSD.

```
┌─────────────────────────────────────────────────────┐
│                  Developer Workstation               │
│                                                     │
│  ┌─────────────┐    ┌─────────────────────────────┐ │
│  │   Browser   │    │      Docker Engine          │ │
│  │  Angular 21 │    │  ┌──────────┐ ┌──────────┐  │ │
│  │  :4200      │    │  │  Kafka   │ │InfluxDB  │  │ │
│  └──────┬──────┘    │  │  :9092   │ │  :8086   │  │ │
│         │           │  └──────────┘ └──────────┘  │ │
│         │ HTTP/WS   └─────────────────────────────┘ │
│         ↓                    ↑ ↑                    │
│  ┌─────────────┐             │ │                    │
│  │ Spring Boot │─────────────┘ │                    │
│  │   :8080     │               │                    │
│  └─────────────┘               │                    │
│         ↑                      │                    │
│         │ MySQL                │                    │
│  ┌─────────────┐    ┌──────────┴─────────┐          │
│  │  MySQL 8    │    │  Python Pipeline   │          │
│  │  :3306      │    │  decoder.py        │          │
│  └─────────────┘    │  can_simulator.py  │          │
│                     │  file_worker.py    │          │
│                     └────────────────────┘          │
└─────────────────────────────────────────────────────┘
```

## Logical Architecture

### Data Flow — Live Simulation

```
┌─────────────────────────────────────────────────────┐
│                  LIVE SIMULATION FLOW               │
│                                                     │
│  can_simulator.py                                   │
│  ├── Loads XML ECU catalog                          │
│  ├── Generates random valid signal values           │
│  ├── Encodes signals into raw CAN bytes             │
│  └── Publishes to Kafka: raw-can-frames             │
│              ↓                                      │
│  decoder.py                                         │
│  ├── Consumes raw-can-frames                        │
│  ├── Decodes bytes using XML catalog                │
│  ├── Maps values to human-readable labels           │
│  └── Publishes to Kafka: decoded-signals            │
│              ↓                                      │
│  CanKafkaConsumer.java                              │
│  ├── Saves frame to MySQL (can_frames)              │
│  ├── Writes signals to InfluxDB (can_signals)       │
│  ├── Runs integrity analysis                        │
│  └── Broadcasts via WebSocket /topic/frames/{id}   │
│              ↓                                      │
│  Angular Frontend                                   │
│  ├── Receives frames via STOMP WebSocket            │
│  ├── Updates live charts (Chart.js)                 │
│  ├── Updates frame table                            │
│  └── Updates pipeline counter                      │
└─────────────────────────────────────────────────────┘
```

### Data Flow — Log File Upload

```
┌─────────────────────────────────────────────────────┐
│                  FILE UPLOAD FLOW                   │
│                                                     │
│  Angular Frontend                                   │
│  └── POST /api/logs/upload (multipart XML/ASC/BLF)  │
│              ↓                                      │
│  LogUploadController.java                           │
│  ├── Saves file to uploads/ directory               │
│  ├── Creates LogFileEntity (status: PROCESSING)     │
│  └── Publishes job to Kafka: file-processing-jobs   │
│              ↓                                      │
│  file_worker.py                                     │
│  ├── Consumes file-processing-jobs                  │
│  ├── Parses .asc / .blf / .log file                 │
│  ├── Decodes using XML catalog                      │
│  └── Publishes to Kafka: session-meta + raw-frames  │
│              ↓                                      │
│  decoder.py + CanKafkaConsumer.java                 │
│  └── Same pipeline as live simulation               │
└─────────────────────────────────────────────────────┘
```

### Data Flow — InfluxDB Replay

```
┌─────────────────────────────────────────────────────┐
│                  REPLAY FLOW                        │
│                                                     │
│  Angular: User clicks Play                          │
│  └── POST /api/playback/start                       │
│              ↓                                      │
│  PlaybackService.java                               │
│  ├── Queries InfluxDB with Flux query               │
│  ├── Streams points sorted by time                  │
│  └── Broadcasts via WebSocket /topic/playback/{id}  │
│              ↓                                      │
│  Angular ReplayEngine                               │
│  ├── Buffers all points until stream complete       │
│  ├── Sorts points by timestamp                      │
│  ├── Starts playback clock (16ms interval)          │
│  └── Feeds points to Chart.js at configured speed   │
└─────────────────────────────────────────────────────┘
```

### Layer Architecture

```
┌─────────────────────────────────────────────────────┐
│              PRESENTATION LAYER                     │
│  Angular 21 Zoneless — Signals + Computed           │
│  Chart.js — Signal visualization                    │
│  STOMP/SockJS — WebSocket client                    │
├─────────────────────────────────────────────────────┤
│               API LAYER                             │
│  Spring Boot REST Controllers                       │
│  Spring Security — JWT + RBAC                       │
│  Spring WebSocket — STOMP broker                    │
├─────────────────────────────────────────────────────┤
│              SERVICE LAYER                          │
│  CanSessionService — session lifecycle              │
│  InfluxWriteService — time-series writes            │
│  PlaybackService — InfluxDB replay streaming        │
│  IntegrityAnalyzerService — fault detection         │
│  CatalogLoaderService — XML catalog parsing         │
│  LogUploadService — async file processing           │
├─────────────────────────────────────────────────────┤
│             MESSAGE LAYER                           │
│  Apache Kafka — raw-can-frames                      │
│  Apache Kafka — decoded-signals                     │
│  Apache Kafka — session-meta                        │
│  Apache Kafka — file-processing-jobs                │
├─────────────────────────────────────────────────────┤
│             PIPELINE LAYER                          │
│  can_simulator.py — CAN frame generation            │
│  decoder.py — signal decoding                       │
│  file_worker.py — log file processing               │
│  xml_decoder.py — ECU catalog XML parsing           │
├─────────────────────────────────────────────────────┤
│              DATA LAYER                             │
│  MySQL 8 — sessions, frames, faults, fleet, users   │
│  InfluxDB 2.7 — signal time-series                  │
└─────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Angular | 21 (Zoneless) | SPA framework, reactive UI with signals |
| Chart.js | Latest | Signal visualization, step-line charts |
| RxStomp / SockJS | Latest | WebSocket STOMP client |
| TypeScript | 5.x | Type-safe frontend development |
| Tailwind CSS | 3.x | Utility-first styling |

### Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Spring Boot | 3.4.1 | REST API, WebSocket broker, security |
| Spring Security | 6.x | JWT authentication, RBAC |
| Spring Data JPA | 3.x | MySQL ORM, repositories |
| Spring WebSocket | 3.x | STOMP message broker |
| Lombok | Latest | Boilerplate reduction |
| Java | 17 (JBR) | Runtime |

### Data Layer

| Technology | Version | Purpose |
|-----------|---------|---------|
| MySQL | 8.0 | Sessions, frames, faults, users, fleet |
| InfluxDB | 2.7 | Signal time-series, replay queries |
| Flyway | Latest | Database migrations |

### Message Layer

| Technology | Version | Purpose |
|-----------|---------|---------|
| Apache Kafka | 3.8 KRaft | Event streaming, decoupled pipeline |

### Python Pipeline

| Technology | Version | Purpose |
|-----------|---------|---------|
| Python | 3.12 | Simulator, decoder, file worker |
| confluent-kafka | Latest | Kafka producer/consumer |
| cantools / python-can | Latest | BLF/ASC log file parsing |
| xml.etree | stdlib | ECU catalog XML parsing |

### Infrastructure

| Technology | Version | Purpose |
|-----------|---------|---------|
| Docker | Latest | Kafka + InfluxDB containerization |
| Maven | 3.x | Java build tool |
| Node.js | 20+ | Angular build + dev server |

## Database Schema

### MySQL Tables

`can_sessions` rows anchor every capture lifecycle with timestamps, aggregates, linkage to fleet cars, and status metadata surfaced in the SPA.

`can_frames` stores relational snapshots of decoded traffic including JSON payloads and sequencing fields that power tables, exports, and integrity joins.

Supporting tables cover vehicles (`cars`), ingestion artifacts (`log_files`), users/roles (`users`), XML catalog bookkeeping (`ecu_catalogs`), and structured fault telemetry (`integrity_faults`) tied back to offending frames.

```
can_sessions          can_frames
─────────────         ──────────────
id (PK)               id (PK)
session_id (UUID)     session_id (FK)
source_filename       timestamp
start_ts              channel
end_ts                channel_name
frame_count           msg_id
status                msg_name
car_id (FK)           raw_bytes
created_at            signals (JSON)
direction
frame_seq
cars                  integrity_faults
─────────────         ────────────────
id (PK)               id (PK)
car_uid (UUID)        session_id (FK)
make                  frame_id (FK)
model                 fault_type
year                  msg_id
vin                   description
is_virtual            frame_timestamp
is_active             detected_at
users                 ecu_catalogs
─────────────         ────────────────
id (UUID, PK)         id (PK)
full_name             name
email                 filename
password_hash         bus_name
roles                 version
created_at            description
is_active
log_files
─────────────
id (PK)
session_id (FK)
filename
file_size
status
frame_count
```

### InfluxDB Schema

```
Measurement: can_signals
Tags:
session_id    — links to MySQL session
signal_name   — decoded signal name
msg_id        — CAN message ID
msg_name      — CAN message name
channel_name  — CAN bus name
label         — human-readable value label
Fields:
value (float) — raw numeric signal value
Timestamp: Unix nanoseconds
```

## Implemented Features

### 1. Live CAN Simulation

The Python simulator generates realistic CAN frames at configurable frequency using XML ECU catalogs. It supports random mode and replay mode with optional fault injection, helping teams stress integrity rules without physical buses.

Key details:

- Frequency: 1–20 Hz configurable via UI slider
- Modes: Random (catalog-driven values) + Replay (from log file)
- Fault injection: timing gaps (16–20s random gaps), counter errors, signal range violations
- Fault rate: 1%–50% configurable
- Car/vehicle linking via --car-uid parameter
- Publishes session-meta on start and COMPLETE on stop

### 2. Real-Time Frame Decoding

The Python decoder consumes raw CAN frames from Kafka and decodes them using XML ECU catalogs into named signals with human-readable labels. Unknown message IDs surface as UNKNOWN ECU, keeping analysts aware of undocumented traffic.

Key details:

- Consumes: Kafka raw-can-frames topic
- Produces: Kafka decoded-signals topic
- Catalog: XML files in python_parser/catalogues/
- Handles: bit masking, byte extraction, value mapping
- Logs warning for unknown ECU message IDs

### 3. Kafka Pipeline

Apache Kafka 3.8 in KRaft mode (no ZooKeeper) acts as the message backbone decoupling pipeline stages so each participant can evolve or fail independently. Topics fan traffic between simulators, decoders, and Java consumers without tight coupling between processes.

Key details:

- Topics: raw-can-frames, decoded-signals, session-meta, file-processing-jobs
- KRaft mode: no ZooKeeper dependency
- Manual offset commit: prevents data loss on crash
- Batching: 16ms buffer windows for WebSocket broadcast

### 4. Dual Database Storage

Decoded frames persist to MySQL for relational querying and simultaneously to InfluxDB for temporal analytics and replay. One consumer path keeps OLTP fidelity aligned with OLAP responsiveness for operators toggling charts and tables.

Key details:

- MySQL: frame metadata, signals as JSON, integrity faults
- InfluxDB: one point per signal per frame, tagged by session_id, signal_name, msg_id, channel_name
- InfluxDB batch writes for performance (5x faster)
- InfluxDB group() by signal_name to merge label variants

### 5. Real-Time WebSocket Streaming

Spring Boot broadcasts decoded batches to Angular using STOMP over SockJS while balancing responsiveness with throughput-friendly batching cadence. Subscribers unify tables, KPI counters, session badges without polling storming middleware.

Key details:

- Protocol: STOMP over SockJS
- Topics: /topic/frames/{sessionId} (live frames), /topic/sessions (session status changes), /topic/playback/{sessionId} (replay points)
- Batch broadcaster: Flux sink → 16ms buffer → group by sessionId → broadcast per session
- COMPLETE notification: instant badge update without page refresh

### 6. Session Management

Sessions move from LIVE through COMPLETE with websocket-driven fidelity so SPA badges stay truthful even under bursty ingestion. Pagination, filtering, cascading deletes, and deep links keep fleets organized while guarding disk and database hygiene.

Key details:

- Status: LIVE → COMPLETE (WebSocket-driven, instant)
- Filters: by vehicle, message ID, bus/channel, faults only, anomaly only
- Pagination: infinite scroll session list
- Delete: full cascade (MySQL frames, InfluxDB points, integrity faults, log file on disk)
- Deep linking: session ID in URL query params

### 7. Log File Upload

Users upload recorded ASC/BLF/log/txt artefacts from the analyzer workspace UI; Spring stages files on disk, enqueues Kafka work, then Python ingestion mirrors simulator semantics. Operators poll statuses until ingestion completes without abandoning investigative context mid-flow.

Key details:

- Formats: .asc (ASCII), .blf (Binary Logging File), .log, .txt
- Async processing: file-processing-jobs Kafka topic
- Status polling: 2s interval until complete/error
- Car linking: carUid passed through full stack to link session to vehicle in fleet
- Inline panel in workspace (no page navigation)

### 8. Signal Chart Visualization

Stacked stepped Chart.js groups visualize signals alongside live simulation or replay timelines for classroom-grade oscilloscope ergonomics without bench-specific binaries. Replay buffers sort asynchronous streams before the playback clock emits frames at selectable speeds matching instructor narration pacing.

Key details:

- Library: Chart.js with custom stepped rendering
- Grouping: one chart group per CAN message ID
- Live mode: RAF loop at 30fps, 50ms throttle, live ticker extends lines at 200ms intervals
- Replay mode: InfluxDB stream → sort by time → playback clock at 16ms interval
- Replay controls: play/pause/seek/speed (0.1x–4x)
- Points sorted after stream complete to fix zigzag

### 9. Frame Table

Paginated frame grids expose timestamps relative to capture start alongside fault-highlighted rows bridging integrity analytics with spreadsheets for auditors. Operators filter anomalies or limit traffic to specific identifiers before exporting sanitized CSV artefacts.

Key details:

- Relative timestamps from session start (0.000s)
- Fault badges: ⚠ on frames with integrity violations
- Filters: message ID, bus/channel, faults only, anomaly only (passed from workspace filter panel)
- CSV export with Bearer token in URL
- Static view for completed sessions

### 10. Integrity Analysis

Integrity checks execute per frame using catalog cyclic expectations, sequencing rules, and permitted enumerations, persisting offences for SPA drill-down summaries. Automated detection accelerates regressions spanning timing, numeric discipline, or repeated counter inconsistencies.

Key details:

- Timing gap detection: frame arrived outside expected cycle time (from catalog Cyclic/cycle field)
- Counter error detection: frame_seq gaps
- Signal range violation: value not in catalog valid values set
- Summary: total faults count per session
- Fault list: type, message ID, timestamp, description

### 11. ECU Catalog Management

Administrators manipulate XML catalogs through SPA workflows while backend services mirror metadata into MySQL and reload Java parsers without manual filesystem juggling. Lifecycle coverage spans upload persistence, enumerated inspection, guarded deletion, and hot reload aligning Python decoders concurrently.

Key details:

- Upload XML → saved to python_parser/catalogues/
- Auto-synced to ecu_catalogs MySQL table on upload
- Detail view: message/signal tree with bit patterns and value maps
- Delete: removes from filesystem + DB
- Reload: triggers CatalogLoaderService.load() hot reload without backend restart
- Auto-sync on startup for existing XML files

### 12. Fleet Management

A vehicle fleet registry links CAN sessions to specific vehicles so histories stay organized per car. Registry fields capture tangible cars plus virtual entries reserved for simulator-only runs without polluting workshop inventory.

Key details:

- Fields: make, model, year, VIN, color, virtual flag
- Virtual vehicles: for simulator-only sessions
- Session linking: via car_id FK on can_sessions
- Upload car linking: carUid passed through full stack

### 13. User Management & Authentication

JWT-based authentication with role-based access control protects all API endpoints while an Angular admin experience supports user administration. Sensitive actions can be attributed through structured audit logging alongside route guards that keep unauthorized operators away from destructive flows.

Key details:

- Auth: JWT Bearer tokens, stored in localStorage
- Roles: Admin, User
- Audit logging: sensitive actions recorded
- Protected routes: Angular route guards
- Admin panel: user list, role management

### 14. 3D Car Model Visualization (Planned)

An interactive 3D car model will render in the browser and react to live CAN signal values, providing intuitive visual feedback of vehicle state for stakeholders who do not interpret hexadecimal frames directly. Three.js (WebGL) bindings will animate doors, headlights, and wipers from the same STOMP-fed signal stream that already powers two-dimensional charts.

Key details:

- Technology: Three.js (WebGL)
- Signal binding: door signals → door animation, headlight signals → light activation, wiper signals → wiper animation
- Data source: same live WebSocket signal stream
- Purpose: makes CAN data understandable for non-technical stakeholders

## Project Structure

```
Kpit_c/
├── backend/                          Spring Boot 3.4.1
│   └── src/main/java/com/example/backend/
│       ├── can/
│       │   ├── controller/           REST API controllers
│       │   ├── entity/               JPA entities
│       │   ├── repository/           Spring Data repos
│       │   ├── service/              Business logic
│       │   ├── kafka/                Kafka consumers
│       │   └── config/               Configuration
│       └── security/                 JWT + RBAC
│
├── Frontend_angular/                 Angular 21
│   └── src/app/
│       ├── features/
│       │   ├── analyser/             CAN Workspace
│       │   ├── sniffer/              Frame viewer + charts
│       │   │   ├── signal-chart/     Chart.js component
│       │   │   ├── live-pipeline/    Pipeline counter
│       │   │   ├── replay-bar/       Playback controls
│       │   │   ├── simulator/        Simulator panel
│       │   │   └── upload/           Log upload panel
│       │   ├── catalogs/             ECU catalog manager
│       │   ├── dashboard/            KPI dashboard
│       │   └── fleet/                Vehicle fleet
│       ├── core/
│       │   ├── services/             LiveTelemetry, Replay
│       │   └── config/               API base URL
│       └── shared/                   Layout, navbar, sidebar
│
├── python_parser/                    Python 3.12
│   ├── can_simulator.py              CAN frame generator
│   ├── decoder.py                    Signal decoder
│   ├── file_worker.py                Log file processor
│   ├── xml_decoder.py                ECU catalog parser
│   ├── log_parser.py                 ASC/BLF parser
│   ├── models.py                     Data models
│   └── catalogues/                   XML ECU catalogs
│       ├── powertrain_can.xml
│       ├── chassis_can.xml
│       ├── car_can.xml
│       ├── key_can.xml
│       ├── body_can.xml
│       └── adas_can.xml
│
├── uploads/                          Uploaded log files
├── docker-compose.yml                Kafka + InfluxDB
└── README.md
```

## Known Limitations & Future Work

### Current Limitations

- Live chart oscilloscope smoothness: charts update at 30fps but backend batches frames in 16ms windows causing visible stepping between updates  
- Single catalogues directory: all XML catalogs are global, no per-vehicle or per-session catalog scoping  
- No real DBC file support: only custom XML catalog format supported (industry standard is .dbc)  
- WebSocket connects on page load even without a live session (minor console error, no functional impact)  
- Pipeline stats InfluxDB count query runs on every poll which may be slow for very large sessions  

### Planned Improvements

- 3D car model visualization with Three.js  
- DBC file format support for industry compatibility  
- Per-vehicle catalog assignment  
- AI-powered anomaly detection (ML model on signal patterns)  
- Mobile-responsive layout  
- Multi-user collaborative session viewing  
- Export to industry formats (MF4, CSV, PCAP)  
- Real hardware CAN interface support (USB-CAN adapter)  
