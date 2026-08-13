# KPIT Smart Real-Time CAN Analyser — Technical Overview

This document summarizes the codebase for someone landing on the project for the first time: purpose, stack, architecture, folders, data flow, patterns, pitfalls, and how major parts depend on each other.

> **Scope note:** The repository contains ~400 tracked items (Java, TS, Markdown, YAML, PNG, scratch logs, etc.). Section 4 documents **every top-level folder and every substantive package subtree**, grouped file patterns where hundreds of classes follow one convention (e.g. Spring DTOs). That matches maintainability limits while remaining actionable. For a literal file manifest, use your IDE tree or `git ls-files`.

---

## 1. Project Purpose & Summary

### What does this project do?

It is an **end-to-end automotive CAN-analysis platform**:

- **Ingest** live or recorded CAN traffic (Python simulator feeding Kafka, or log upload → file worker → Kafka).
- **Decode** frames using **XML ECU catalogs** (Python `xml_decoder` / `decoder.py`).
- **Persist** relational session/frame/fault/catalog/fleet/auth data in **MySQL** and **signal time-series** in **InfluxDB**.
- **Stream** decoded activity to browsers via **Spring WebSocket (STOMP over SockJS)** for live charts, tables, and session status.
- **Expose REST APIs** (Spr   ing Boot) for uploads, playback, fleets, catalogs, dashboards, simulator control, IAM, MFA, auditing, etc.
- Provide an **Angular 21 zoneless SPA** as the operator UI.

### Who is it for?

- Automotive / embedded engineers validating buses and integrations.
- Internship/academic reviewers (rich `docs/` and PFE narratives).
- DevOps-ish local setups: Kafka + Influx via Docker; MySQL often native Windows.

### What problem does it solve?

It collapses multiple concerns—**simulate/decode/store/stream/visualise/analyse integrity/manage fleet & catalogs/authenticate—into one monorepo** instead of juggling proprietary bench tools, ad hoc scripts, and disconnected databases without a coherent web UX.

---

## 2. Technology Stack

### Languages & runtimes

| Item | Role in this repo |
|------|-------------------|
| **Java 17** | Spring Boot backend, Kafka consumer, REST, WebSocket broker, security, JPA. |
| **TypeScript (~5.9)** + **Angular 21** | SPA, zoneless change detection (`provideZonelessChangeDetection`), routed lazy loading, signals (`@ngrx/signals` in stores). |
| **Python 3.x** | Kafka producers/consumers: simulator, decoder, file worker; XML catalog loading; ASCII log parsing. |
| **SQL (Flyway)** | Versioned schema in `db/migrations/`. |

### Frontend libraries (from `Frontend_angular/package.json`)

| Library | Why it’s here |
|---------|----------------|
| **Chart.js** | Step-line signal charts (`signal-chart`). |
| **@stomp/rx-stomp** + **sockjs-client** | STOMP/WebSocket client to Spring’s `/ws-ecu-gateway`. |
| **Tailwind CSS** | Utility-first styling alongside component SCSS. |
| **RxJS** | Streams, interceptors, async UI. |
| **lucide-angular** | Icons. |

### Backend (`pom.xml` highlights)

| Technology | Why it’s here |
|------------|----------------|
| **Spring Boot 3.4.x** | Application container, auto-config, actuator. |
| **Spring MVC** | REST controllers (`@RestController`). |
| **Spring Data JPA** | MySQL ORM (`*Repository`, `*Entity`). |
| **Spring Security + JWT (jjwt)** | Stateless APIs; Bearer tokens; MFA flows. |
| **Spring Kafka** | `CanKafkaConsumer` listens to `decoded-signals`, `session-meta`, `log-file-events`; manual acknowledge for safety. |
| **Spring WebSocket + STOMP** | Push frames/playbacks/session events to SPA. |
| **Reactor** | Batching sinks (e.g. WebSocket broadcasting cadence). |
| **InfluxDB Java client** | Writes/queries telemetry bucket `ecu_telemetry`. |
| **MapStruct + Lombok** | DTO mapping and boilerplate reduction. |
| **SpringDoc OpenAPI** | Swagger (`/swagger-ui.html`). |
| **Caffeine + `@Cacheable`** | Dashboard caching. |
| **Bucket4j** | Rate limiting filter. |
| **Spring Mail** | OTP / notifications. |
| **AWS SDK S3** | Optional avatar storage. |
| **H2 (test)** | In-memory DB for tests. |

### Python (`python_parser/requirements.txt`)

| Dependency | Why |
|------------|-----|
| **confluent-kafka** | Kafka client for simulator / decoder / file_worker. |
| **lxml** | XML parsing utilities where used. |
| **dataclasses-json** | JSON serialization helpers. |
| **pytest** | Tests under `tests/`. |

(Decoding uses **stdlib** plus local modules `xml_decoder`, `models`. BLF/other binary formats depend on paths implemented in parsers—ensure venv installs any extra parsers your branch needs.)

### Infrastructure & tools

| Tool | Role |
|------|------|
| **Docker Compose** (`docker-compose.yml`) | **Kafka** (KRaft) + **InfluxDB 2.7**. |
| **MySQL 8** | Primary relational DB (`spring.datasource.*`, Flyway-managed). |
| **Maven (`mvnw`)** | Java build. |
| **Node/npm** | Angular CLI build/serve. |

### Environment-driven config

Secrets and ports are wired via `application.properties` + optional `application-secrets.properties` and env vars: `DB_PASSWORD`, `JWT_SECRET`, `INFLUXDB_TOKEN`, mail creds, `STORAGE_TYPE`, etc.

---

## 3. Architecture Overview

### High-level shape

This is a **monorepo** with **multiple deployable/runable processes**, not classic microservices in separate repos:

| Process | Responsibility |
|---------|----------------|
| Angular dev server (`ng serve`) | Browser UI (~4200). |
| Spring Boot JAR | REST + WebSocket + Kafka consumer (~8080). |
| MySQL | Persistence. |
| Docker: Kafka | Message bus (~9092). |
| Docker: InfluxDB | Time series (~8086). |
| Python scripts | Separate OS processes spawned manually or via `SimulatorController` for `can_simulator.py`; typically long-running terminals for `decoder.py` / `file_worker.py`. |

**Pattern:** Event-driven backbone (**Kafka**) decouples Python pipeline stages from JVM consumers; **STOMP** decouples server push from SPA polling except where REST polling is deliberate (upload status).

### ASCII — logical view

```
[Browser: Angular]
    │  HTTPS REST (JWT) ─────────────────────────► [Spring Boot :8080]
    │  WSS/STOMP SockJS ─────────────────────────► [same: /ws-ecu-gateway]
    │
    │ reads/writes        MySQL ◄───────────────────┤ Spring Data JPA
    │                    InfluxDB ◄──────────────────┤ Influx client
    │
[Python can_simulator] ──Kafka: raw-can-frames──► [decoder.py]
                            ▲                           │
                            │                           ▼ Kafka: decoded-signals
[file_worker.py] ───────────┘                      [CanKafkaConsumer]
    ▲Kafka: file-processing-jobs                      │ MySQL frames + faults
    │                                                   │ Influx signals
    └──────────────── LogUploadController + jobs      │
                                                      └──► STOMP /topic/…
                                                           replay: PlaybackService
```

---

## 4. Folder & File Breakdown

### Repository root (`Kpit_c/`)

| Path / file | Purpose |
|-------------|---------|
| `README.md`, `PROJECT_REPORT.md`, `PROJECT_ARCHITECTURE_REPORT.md`, `TECHNICAL_OVERVIEW.md` | Human-readable project documentation (this file is the architecture-oriented onboarding guide). |
| `docker-compose.yml` | Spins up **kafka** + **influxdb** only; MySQL assumed external/native. |
| `db/migrations/` | **Flyway** SQL migrations (`V1__`…)—source of truth for relational schema additions. |
| `uploads/` | Runtime landing zone for uploads (avatars subpath, CAN logs)—paths mirrored in `application.properties` (`pipeline.uploads.dir`, etc.). |
| `docs/` | Deep PFE journaling, testing checklists, PlantUML diagrams—**documentation only**, not wired into builds. |
| `log_file.txt`, `python_parser/_sim*.txt` | Appear to be local scratch/logs—typically should not drive behavior; consider `.gitignore` hygiene. |

### `backend/` — Spring Boot

| Area | Contents & conventions |
|------|-------------------------|
| `pom.xml`, `mvnw*` | Maven build; pinned Spring Boot Parent. |
| `src/main/java/com/example/backend/BackendApplication.java` | JVM entry: `@SpringBootApplication`. |
| `config/` (`SecurityConfig`, `WebMvcConfig`, `DataInitializer`, …) | Cross-cutting Bean wiring: filters, CORS, security chain, bootstrap data. |
| `security/` | JWT filter, heartbeat, rate limit, user details adapters. |
| `controller/` + `controller/v1/` | REST: `AuthController`, admin/user/profile APIs (`*ControllerV1`). |
| `can/controller/` | **CAN-domain** REST: `CanController`, `CarController`, `CatalogController`, `DashboardController`, `InfluxController`, `IntegrityController`, `LogUploadController`, `PlaybackController`, `SimulatorController`. Prefer adding CAN features here vs mixing with IAM controllers. |
| `can/service/` | Business orchestration (`CanSessionService`, `InfluxWriteService`, `PlaybackService`, integrity, catalogs, uploads, …). |
| `can/repository/`, `repository/` | Spring Data interfaces; CAN vs IAM namespaces split for clarity. |
| `can/entity/`, `entity/` | JPA entities—CAN entities deliberately avoid `@ManyToOne` in places (foreign keys as `Long`/string IDs) to ease JSON/API concerns. |
| `can/config/` | `KafkaTopicConfig`, `InfluxDbConfig`, `CatalogProperties`, Jackson tuning. |
| `can/kafka/` | **`CanKafkaConsumer`**—Kafkalisteners bridging topics → DB + WebSocket. |
| `can/dto/` | CAN-specific request/response DTOs (`CanFrameResponse`, fleet/car DTOs, dashboard stats). |
| `dto/auth/`, `dto/v1/`, `dto/common/`, `dto/permission/` | IAM and shared paging/error contracts. |
| `service/` (root) | `AuthService`, `UserServiceV1`, `EmailService`, `MfaTotpService`, etc. |
| `mapper/` | MapStruct interfaces (entities ↔ API models). |
| `audit/` | `@AuditAspect` + `@AuditLog`—declarative security-relevant auditing. |
| `exception/` | `GlobalExceptionHandler`—uniform API errors. |
| `storage/` | Local vs S3 avatar storage abstraction. |
| `src/main/resources/application.properties` | Central runtime configuration (critical for pipelines and ports). |
| `src/test/` | Java tests (`schema-test.sql`, H2). |
| Scattered `*.md` under `backend/` | Internal reports/integration notes. |

### `Frontend_angular/`

| Area | Purpose |
|------|---------|
| `package.json`, `angular.json`, `tsconfig*` | NPM scripts, Angular build config (CLI 21). |
| `src/main.ts`, `src/app/app.config.ts`, `src/app/app.component.ts`, `src/app/app.routes.ts` | **Bootstrap**, zoneless providers, HTTP interceptors (JWT + errors), lazy route graph under `/admin` + `/auth`. |
| `src/app/core/` | **Cross-cutting SPA**: `config/api.config.ts` ( **`API_BASE_URL`** must match backend), guards (`auth.guard`, `admin.guard`, `permission.guard`), interceptors, **`services/`** (HTTP facades: `can.service.ts`, `auth.service.ts`, `live-telemetry.service.ts`, `replay-engine.service.ts`, …). |
| `src/app/store/` | Lightweight state (`auth.store`, `user.store`, `dashboard.store`, …) built on `@ngrx/signals`. |
| `src/app/data/` | Shared **TypeScript models/types** consumed by components (`can.model.ts`, auth/user models). |
| `src/app/layouts/admin-layout/` | Shell with navbar/sidebar outlet for authenticated area. |
| `src/app/shared/` | Reusable UI: layout (navbar, sidebar), data-table, modal, toast, skeleton, directives. |
| `src/app/features/` | **Feature slices** loaded by router: |
| └ `auth/` | Login/register/MFA/forgot-password flows (`auth.routes.ts`). |
| └ `dashboard/` | KPI widgets (charts wired to REST). |
| └ `sniffer/` | Heavy CAN UX: sessions, simulator, signal chart, frame table, live pipeline (`sniffer.routes.ts`). |
| └ `analyser/` | **`can-workspace.component.ts`**—workspace integrating upload/filter/session UX. |
| └ `catalogs/` | **`catalog-page.component.ts`**—ECU catalog list/upload against `/api/catalogs`. |
| └ `fleet/` | Vehicle fleet management. |
| └ `users/`, `settings/`, `profile/` | IAM admin/settings/profile (`*.routes.ts` lazy children). |
| `src/assets/` | Static assets placeholders. |
| `ui_design/` | Reference PNG mockups—not compiled into app unless imported. |
| Various `*_GUIDE.md` | Frontend integration narratives. |

**Convention:** Prefer **standalone** components (`standalone: true`) + lazy `loadComponent` / `loadChildren` to keep bundles small.

### `python_parser/`

| File | Purpose |
|------|---------|
| `decoder.py` | Consumes **`raw-can-frames`**, decodes via `xml_decoder`, produces **`decoded-signals`**. |
| `can_simulator.py` | Generates raw frames → **`raw-can-frames`**; simulator args include session metadata and optional faults. |
| `file_worker.py` | Consumes **`file-processing-jobs`**, parses logs, emits **`raw-can-frames`** + **`log-file-events`**. |
| `xml_decoder.py` | Parses XML catalogs into in-memory defs; encode/decode helpers. |
| `log_parser.py` | ASCII CAN log ingestion → `ParsedSession`/frames. |
| `models.py` | Dataclasses for decoded frames/catalog structures. |
| `live_can.py`, `static_parser.py` | Supporting parsers/utilities depending on ingestion mode. |
| `catalogues/*.xml` | ECU definitions—shared with JVM `catalog.path` and Angular catalog UI uploads. |
| `tests/` | Pytest suites. |

> **`pipeline.py`** is referenced from `application.properties` as `pipeline.python.script`, but **it may not exist in every checkout** (`SimulatorController` swaps `pipeline.py` → `can_simulator.py` dynamically). Confirm before relying on subprocess paths.

### `db/migrations/`

Sequential Flyway migrations; **ordering matters** (`V1` before `V2`…). Editing old migrations after release is forbidden in production workflows—append new versions.

---

## 5. Data Flow & Main Entry Points

### A. User-facing entry points

1. **Browser** loads Angular (`/` → redirect to `/auth/login`, authenticated area under `/admin/...`).
2. **JWT** acquired via `/api/auth/login` (+ MFA paths); thereafter `Authorization: Bearer …` injected by `authInterceptor` for non-public URLs.
3. **WebSocket** connection to `spring.websocket.path` (**`/ws-ecu-gateway`**) authenticated at STOMP connect (JWT in connect headers)—see backend WebSocket config.

### B. Typical live-CAN pipeline

1. User starts simulator (UI → `SimulatorController` spawns **`can_simulator.py`** or manual terminal).
2. Simulator publishes JSON frames to **`raw-can-frames`**.
3. **`decoder.py`** consumes, publishes **`decoded-signals`**.
4. **`CanKafkaConsumer`** commits after persisting MySQL frames + writing Influx points + integrity analysis → pushes summaries on STOMP (`/topic/frames/{sessionId}`, `/topic/sessions`, etc.—exact topics in consumer code).
5. Angular **`live-telemetry.service`**/`sniffer.component` consumes STOMP payloads and updates Chart.js datasets + tables.

### C. Upload pipeline

1. Angular `multipart` **`POST`** log upload endpoint (see **`LogUploadController`**).
2. File saved under `pipeline.uploads.dir`; Kafka **`file-processing-jobs`** emitted.
3. **`file_worker.py`** parses, feeds **`raw-can-frames`**; lifecycle on **`log-file-events`** informs Java side (`CanKafkaConsumer`).
4. Converges on same decode + persist + push path.

### D. Replay pipeline

1. User triggers **`POST /api/playback/start`** (`PlaybackController` → **`PlaybackService`**).
2. Service queries Influx (**Flux**) and streams points over **`/topic/playback/{playbackId}`** (or analogous binding—verify controller for exact IDs).
3. Angular **`replay-engine.service`** schedules chart updates (sorted points, playback speed controls).

---

## 6. Key Concepts & Patterns

### Backend patterns

| Pattern | Example |
|---------|---------|
| **Layered (Controller → Service → Repository)** | `CarController` → `CarService` → `CarRepository`. |
| **DTO boundary** | Entities not exposed blindly; MapStruct bridges. |
| **Repository + Specifications** (`UserSpecification`) | Dynamic querying for IAM lists. |
| **Aspect-oriented auditing** | `@AuditLog` on mutations. |
| **Manual Kafka ack** | After DB side-effects succeed (`MANUAL_IMMEDIATE`). |
| **ConfigurationProperties** | `CatalogProperties`, influx props. |

### Frontend patterns

| Pattern | Example |
|---------|---------|
| **Standalone + lazy routes** | Faster initial bundles. |
| **Zoneless + signals/COMPUTED** | `catalog-page`, stores. |
| **Interceptor-based auth** | Centralized Bearer attachment. |
| **Feature-folder isolation** | Add new UI under `features/<name>/` + route stub. |

### Adding new backend code safely

1. Flyway migration if schema changes (`db/migrations/Vn__…sql`).
2. Entity + Repository + Service + Controller (or narrow addition to existing service).
3. OpenAPI-visible if `@RestController` on secured path consistent with **`SecurityConfig.PUBLIC_PATHS`**.
4. Kafka: register topic constants & consumer branch in **`KafkaTopicConfig` / consumer** symmetry with Python publishers.

### Adding new Angular code safely

1. Route entry in `app.routes.ts` or child `*.routes.ts`.
2. Service call through `HttpClient` + `API_BASE_URL` (avoid hardcoding host).
3. STOMP subscriptions mirror backend destination naming (session vs playback prefixes).

---

## 7. What You Should Know Before Touching Anything

### Critical gotchas

- **Kafka + InfluxDB must run** (`docker-compose up`) before decoding stack end-to-end; **MySQL** must exist with **`DB_PASSWORD` / JDBC URL valid** — boot fails silently on features until DB reachable.
- **Influx env**: `INFLUXDB_TOKEN` + init password `.env` for compose—without them writes/queries die.
- **Path coupling**: Many props use **hard-coded `C:/tools/Kpit_c/...`** paths on Windows (`pipeline.*`, catalogs). Changing machine layout requires aligning **Angular `API_BASE_URL`**, **Spring props**, **Python cwd**, and symlinked catalog dirs together.
- **Missing `pipeline.py`**: Simulator relies on rewriting script path—verify subprocess actually resolves.
- **Security**: JWT secret length, actuator exposure, Swagger in prod—currently dev-friendly defaults.
- **Rate limiting / filters ordering** in `SecurityConfig` interact with SockJS handshake—don’t blindly reorder filters.
- **`ddl-auto=none`** — schema is Flyway-controlled; Hibernate won’t auto-fix drift.
- **CAN entities omit JPA `@ManyToOne`** in spots—JOINs handled manually in repos/services; naive JSON graphs won’t recurse.

### Areas often marked TODO / legacy smells (scan periodically)

Use `grep -r "TODO\|FIXME" backend Frontend_angular python_parser` on your checkout; interns left narrative notes in **`docs/pfe_report_explanation/`** referencing refactors (`dead_code_xml`, simulator pages, legacy layout). Frontend warnings (e.g. unused imports in `sniffer.component`) surfaced in Angular builds historically—keep build output clean before releases.

---

## 8. Folder Dependency Map

### Frontend ↔ Backend

```
[Frontend_angular/src/app/core/config/api.config.ts]
      │ exports API_BASE_URL (e.g. http://localhost:8080)
      ↓ configures base for
[Angular HttpClient calls in core/services/*.ts & feature components]
      ↓ HTTPS + Bearer (authInterceptor → localStorage access_token)
[Spring MVC Controllers — /api/** and /api/can/** …]
```

**Sharing:** REST JSON contracts (**no shared codegen**)—types duplicated manually in `src/app/data/models`. Changing DTO shapes requires **paired** Java + TS edits.

```
[Angular STOMP RxStomp + sockjs-client]
      ↓ websocket upgrade + stomp CONNECT (JWT headers)
[spring-boot-starter-websocket + STOMP endpoints]
      ↓ broadcasts from
[CanKafkaConsumer / PlaybackService / session services]
```

**Sharing:** **Topic naming convention** (`/topic/frames/{sessionId}`, `/topic/sessions`, `/topic/playback/...`). Breaking rename requires **dual** Angular + Spring changes.

---

### Python ↔ Kafka ↔ Java ↔ DB

```
[python_parser/*.py producers/consumers]
      ↓ read/write Kafka topics:
        raw-can-frames, decoded-signals,
        session-meta, file-processing-jobs, log-file-events
      ↓
[spring.kafka.* configured consumer]
```

**Sharing:** Only **serialized JSON payloads** on topics—not Java classes. Decoder & consumer must evolve **schemas in lockstep**.

```
[decoder.py reads XML]
      ↓ filesystem path ./catalogues (or CLI arg)

[Spring CatalogLoaderService + CatalogProperties catalog.path]
      ↓ parses same catalog directory for integrity rules

[CatalogController + EcuCatalogRepository]
      ↑ writes XML + mirrors rows to MySQL ecu_catalogs

[Angular catalogs feature]
      ↑ uploads via REST multipart
```

**Sharing:** **`python_parser/catalogues`** directory is the authoritative file store **and** mirrored in DB rows for fleet linkage—do not orphan one layer.

---

### Config hubs everything relies on

| Config | Consumers |
|--------|-----------|
| `application.properties` | All Spring beans (Kafka bootstrap, datasource, JWT, websocket path, pipeline python executable, uploads dirs). |
| `docker-compose.yml` + `.env` | Kafka/Influx only. |
| `db/migrations` | Hibernate entities must match migrated schema (`ddl-auto=none`). |
| `API_BASE_URL` (Angular) | All REST clients. |

```
[application.properties + optional application-secrets.properties]
      └─► required by virtually every backend module
```

---

### Folder pairs that CANNOT operate alone

| Without | Broken piece |
|---------|---------------|
| **Kafka running** | Python ↔ Java telemetry path; uploads stall; consumer idle. |
| **MySQL** | No auth, sessions, fleets, frames—Spring Boot unhealthy for core APIs. |
| **InfluxDB** (when using charts/replay/dashboard metrics) | Time-series APIs / playback degraded or failing. |
| **`python_parser` venv processes** (`decoder.py` at minimum) | Raw frames never become `decoded-signals` → JVM consumer idle. |
| **Angular `API_BASE_URL` wrong** | All REST calls misrouted/CORS madness. |

Python scripts **can** run **without Angular** for headless ingestion tests; JVM **still needs Kafka + MySQL** for integrated stories.

---

### ASCII dependency graph (aggregated folders)

```
[Frontend_angular/src/app/features/* & core/services/*]
        │ HTTPS JSON DTO contracts (manual parity with backend DTOs)
        ↓
[backend/can/controller/* + backend/controller/v1/*]
        │ invokes
[backend/can/service/* + backend/service/*]
        │ persists via
[backend/*/repository/* → MySQL Entities]
        │ time-series via
[influx Java client ← InfluxDB container]

[python_parser/can_simulator + decoder + file_worker]
        │ Kafka protocol JSON
        ↑↓
[Kafka Docker container]

[CanKafkaConsumer]
        ├── reads Kafka
        ├── writes MySQL / Influx
        └── emits STOMP → Frontend WebSocket Client

[db/migrations/*.sql]
        └── prerequisite schema for ──► JPA Entities
```

---

### Related internal docs

- `README.md` — product/feature summary & quick commands.
- `PROJECT_REPORT.md` — formal internship-style narrative & diagrams.
- `PROJECT_ARCHITECTURE_REPORT.md` — may overlap architecturally—compare if present.
- `docs/testing/complete_test_checklist.md` — manual QA compass.
- `docs/uml/*.puml` — sequence/component views.

---

**End of TECHNICAL_OVERVIEW.md** — Maintain this file when you materially change Kafka topics, websocket paths, or cross-process contracts.
