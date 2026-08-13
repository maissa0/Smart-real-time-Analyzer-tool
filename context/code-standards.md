# Code Standards — KPIT Smart Real-Time CAN Analyser

## General
- Keep every class, service, and component single-purpose — one reason to change
- Fix root causes of bugs; never layer workarounds on top of broken behavior
- Do not mix unrelated concerns in one class — decoding logic stays in Python, persistence stays in Java services, rendering stays in Angular components
- Delete dead code immediately — unused components, routes, console.log calls, and commented-out blocks must not be committed
- Never hardcode environment-specific values (ports, tokens, passwords, URLs) — all config comes from environment variables or application.properties
- Write code that is readable first, clever second — a junior engineer must understand it without asking
- One concern per commit — do not mix bug fixes, refactors, and features in the same commit
- Always audit the current state of a file before modifying it — never assume its contents

## Java (Spring Boot)
- Use constructor injection exclusively — never field injection with @Autowired
- Every public service method must have a clear return type — never return raw Object
- Use @Builder on all JPA entities and DTOs — never construct them with long positional constructors
- Do not declare @ManyToOne or @OneToMany JPA relationships on entities — use scalar FK columns (Long, String) to avoid lazy loading issues and N+1 query explosions
- Wrap all InfluxDB Flux queries and writes in try-catch — InfluxDB errors must never crash the Kafka consumer
- Use @Column(name = "...") explicitly on every JPA field — never rely on implicit column name mapping
- Never call repository methods directly from controllers — always go through a service layer
- All Kafka consumer methods must use manual offset commit — never auto-commit, to prevent data loss on crash
- Remove all System.out.println and debug log statements before committing — use SLF4J @Slf4j logger with appropriate levels (log.info, log.warn, log.error)
- Use @Transactional only on service methods that genuinely need atomicity — not as a default annotation on everything

## Python
- Every Kafka producer and consumer must use manual offset commit — never rely on auto-commit
- Use parse_log_stream() for all log file processing — never parse_log() which loads all frames into memory at once and will crash on 2-hour files
- All XML catalog parsing must happen at startup via CatalogLoaderService equivalent — never re-read XML files inside a per-frame processing loop
- Never publish decoded signals directly from file_worker.py — always publish raw frames to raw-can-frames and let decoder.py handle decoding, to keep the pipeline consistent
- Use argparse for all script configuration — never hardcode Kafka broker URLs, topic names, or catalog paths inside script logic
- All Kafka consumer poll loops must handle KeyboardInterrupt gracefully — publish session COMPLETE to session-meta before exiting
- Remove all print() debug statements before committing — use Python logging module with appropriate levels
- Use generators and yield for frame iteration — never build large lists of frames in memory

## Angular (Frontend)
- Use Angular Signals (signal(), computed(), effect()) for all reactive state — never use BehaviorSubject or Subject for local component state
- Never subscribe to Observables inside component class bodies without unsubscribing — use the async pipe or takeUntilDestroyed()
- Use the inject() function for dependency injection — not constructor parameter injection
- All chart updates must go through the RAF (RequestAnimationFrame) loop — never call chart.update() directly from a WebSocket message handler
- Apply filters (msgId, bus, faultsOnly, anomalyOnly) at the API query level — never filter large arrays in the component after fetching all data
- Never load all frames for a session at once — always use pagination (page + size parameters)
- Keep components dumb — business logic belongs in services, not in component methods
- Every @Input() signal must be initialized with a default value or explicitly typed as input.required()
- Remove all console.log statements before committing
- Never navigate away from the workspace to perform an action (upload, catalog) — use inline panels

## REST API (Spring Boot Controllers)
- Validate and sanitize all path variables and request parameters before any logic runs — prevent path traversal attacks on filename inputs
- Enforce JWT authentication and role authorization before any mutation — never rely on the client to self-report its role
- Return consistent response shapes — success responses always include the relevant entity or confirmation map; error responses always include a message field
- Use ResponseEntity with explicit HTTP status codes — 201 for creation, 204 for deletion, 400 for bad input, 404 for not found, 403 for unauthorized
- Never expose internal stack traces in API error responses — log them server-side only
- All file upload endpoints must validate MIME type and file extension before saving to disk
- Use specific @RequestMapping paths — no wildcard routes that catch unintended requests
- Controller methods must be thin — one call to a service method, then return the response

## Kafka & Messaging
- Topic names are constants — define them once in a shared config class, never repeat string literals
- Producers must handle send failures explicitly — log errors, never silently swallow them
- Consumers must be idempotent where possible — processing the same message twice must not corrupt data
- Batch the WebSocket broadcast using a 16ms buffer window (Sinks.Many + Flux.buffer) — never broadcast frame by frame which would overwhelm connected clients
- The ML anomaly scoring consumer must run in a separate consumer group from the main CanKafkaConsumer — never block frame persistence waiting for ML inference
- Kafka topic registry (all five topics in use):
  - `raw-can-frames` — raw frames produced by can_simulator.py and file_worker.py; consumed by decoder.py
  - `decoded-signals` — decoded frames produced by decoder.py; consumed by CanKafkaConsumer (group `kpit-backend`) and anomaly_scorer.py (group `anomaly-scorer-group`)
  - `session-meta` — session lifecycle events; consumed by CanKafkaConsumer
  - `file-processing-jobs` — async log upload jobs; consumed by file_worker.py
  - `anomaly-events` — anomaly scoring results produced by anomaly_scorer.py; payload: {session_id, timestamp, msg_id, msg_name, channel_name, anomaly_score, threshold, scoring_phase, signals_flat}

## Data and Storage
- Signal time-series data belongs in InfluxDB — never store it as a column in MySQL
- Session and frame metadata belongs in MySQL — never query MySQL for time-series replay
- Large files (uploaded log files, generated PDFs) belong on disk under the uploads/ directory — never store binary content as a BLOB in MySQL
- ECU catalog files belong on the filesystem under python_parser/catalogues/ — the MySQL ecu_catalogs table stores only metadata (name, filename, bus_name, is_active), not the XML content
- Never store passwords or JWT secrets in the database or in committed code — use environment variables
- All session deletions must cascade: MySQL frames → MySQL faults → MySQL log file record → InfluxDB points → file on disk — in that order, each step logged
- Use @CreationTimestamp and @UpdateTimestamp on entity audit fields — never set them manually

## Styling (Angular / Tailwind)
- Use Tailwind utility classes exclusively — no inline style attributes, no component-scoped CSS files for layout
- Never hardcode hex color values — use only Tailwind color tokens (e.g. text-green-600, bg-blue-50) or CSS custom properties defined in tailwind.config
- Badge colors must follow the established domain color scheme: green for LIVE/active, gray for COMPLETE, red for faults, orange for anomalies — never invent new badge colors
- Chart colors must follow the signal domain palette defined in the workspace component — never use random colors per render

## API Routes
- Validate and sanitize all path variables and request parameters before any logic runs — prevent path traversal attacks on filename inputs
- Enforce JWT authentication and role authorization before any mutation — never rely on the client to self-report its role
- Return consistent response shapes — success responses always include the relevant entity or confirmation map; error responses always include a message field
- Use ResponseEntity with explicit HTTP status codes — 201 for creation, 204 for deletion, 400 for bad input, 404 for not found, 403 for unauthorized
- Never expose internal stack traces in API error responses — log them server-side only
- All file upload endpoints must validate MIME type and file extension before saving to disk
- Use specific @RequestMapping paths — no wildcard routes that catch unintended requests
- Controller methods must be thin — one call to a service method, then return the response

## Data and Storage
- Signal time-series data belongs in InfluxDB — never store it as a column in MySQL
- Session and frame metadata belongs in MySQL — never query MySQL for time-series replay
- Large files (uploaded log files, generated PDFs) belong on disk under the uploads/ directory — never store binary content as a BLOB in MySQL
- ECU catalog files belong on the filesystem under python_parser/catalogues/ — the MySQL ecu_catalogs table stores only metadata (name, filename, bus_name, is_active), not the XML content
- Never store passwords or JWT secrets in the database or in committed code — use environment variables
- All session deletions must cascade: MySQL frames → MySQL faults → MySQL log file record → InfluxDB points → file on disk — in that order, each step logged
- Use @CreationTimestamp and @UpdateTimestamp on entity audit fields — never set them manually


## File Organization

### Backend (Java)
- `backend/src/main/java/com/example/backend/can/entity/` — JPA entities mapping to MySQL tables
- `backend/src/main/java/com/example/backend/can/repository/` — Spring Data JPA repository interfaces
- `backend/src/main/java/com/example/backend/can/service/` — Business logic services
- `backend/src/main/java/com/example/backend/can/controller/` — REST API controllers
- `backend/src/main/java/com/example/backend/can/kafka/` — Kafka consumer classes
- `backend/src/main/java/com/example/backend/can/config/` — Kafka, InfluxDB, and WebSocket configuration
- `backend/src/main/java/com/example/backend/entity/` — Auth-related JPA entities (User, Role, Permission, etc.)
- `backend/src/main/java/com/example/backend/security/` — JWT filter, Spring Security config, RBAC logic
- `backend/src/main/resources/db/migration/` — Flyway SQL migration files — one file per schema change

### Frontend (Angular)
- `Frontend_angular/src/app/features/analyser/` — CAN Workspace page component
- `Frontend_angular/src/app/features/sniffer/` — Frame table, signal charts, replay bar, live pipeline, simulator panel, upload panel
- `Frontend_angular/src/app/features/catalogs/` — ECU Catalog management page
- `Frontend_angular/src/app/features/fleet/` — Vehicle fleet management page
- `Frontend_angular/src/app/features/dashboard/` — KPI dashboard page
- `Frontend_angular/src/app/core/services/` — Shared services (LiveTelemetryService, ReplayEngineService)
- `Frontend_angular/src/app/core/config/` — API base URL and environment constants
- `Frontend_angular/src/app/shared/layout/` — Sidebar, navbar, shell layout components
- `Frontend_angular/src/app/shared/components/` — Reusable UI components (badges, spinners, modals)

### Python Pipeline
- `python_parser/can_simulator.py` — CAN frame generator — reads XML catalogs, publishes to raw-can-frames
- `python_parser/decoder.py` — Signal decoder — consumes raw-can-frames, publishes to decoded-signals
- `python_parser/file_worker.py` — Log file processor — consumes file-processing-jobs, streams frames via parse_log_stream
- `python_parser/xml_decoder.py` — XML catalog parser — shared utility, not a standalone script
- `python_parser/log_parser.py` — ASCII CAN log parser (.asc, .log, .txt) — shared utility used by file_worker.py and can_simulator.py; exposes parse_log_stream() (streaming, production) and parse_log() (full-load, tests only)
- `python_parser/static_parser.py` — BLF (Vector Binary Logging Format) parser — adjunct utility used exclusively by file_worker.py; exposes parse_blf() and get_blf_metadata()
- `python_parser/models.py` — Shared dataclasses (DecodedFrame, DecodedSignal, MessageDefinition, SignalDefinition, ParsedSession) — used by all pipeline scripts; not a standalone runner
- `python_parser/anomaly_scorer.py` — IsolationForest ML consumer — separate Kafka consumer group
- `python_parser/catalogues/` — XML ECU catalog files — one file per CAN bus domain
- `python_parser/models/` — Trained ML model artifacts (.pkl files) — never committed to git if large

### Project Root
- `uploads/` — Uploaded CAN log files — never committed to git
- `docker-compose.yml` — Kafka and InfluxDB container definitions
- `README.md` — Project overview and getting started guide
- `.env` — Environment variables (secrets, ports) — never committed to git, listed in .gitignore