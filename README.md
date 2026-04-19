# Smart Real-Time CAN Analyzer

> **PFE / Internship Project — KPIT Technologies**
> Developer: **Molka Elleuch**

A full-stack web platform for decoding, simulating, and visualizing CAN (Controller Area Network) bus traffic in real time. The system combines a Python parser, a Spring Boot backend with Kafka and WebSocket, and an Angular 21 frontend with interactive time-series charts.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Features](#4-features)
5. [Architecture](#5-architecture)
6. [How to Run Locally](#6-how-to-run-locally)
7. [API Endpoints](#7-api-endpoints)
8. [Signal Definitions (XML Format)](#8-signal-definitions-xml-format)
9. [Roadmap](#9-roadmap)

---

## 1. Project Overview

CAN bus is the communication backbone of every modern vehicle — it carries hundreds of signals (door locks, engine RPM, battery state, etc.) at up to 1 Mbit/s. Automotive engineers spend hours manually parsing raw `.txt` log files with hex addresses and byte arrays to understand what happened during a test drive.

**Smart Real-Time CAN Analyzer** solves this by:

- **Parsing** raw CAN log files using XML signal definitions to decode bit-level signals into human-readable labels
- **Streaming** decoded frames frame-by-frame over Server-Sent Events (SSE) so results appear in real time while the file is still being processed
- **Simulating** synthetic CAN traffic generated server-side, transported via **Apache Kafka**, and pushed to the browser over **WebSocket (STOMP)**
- **Visualising** signal states as interactive step charts (one state transition per chart card) with zoom, pan, expand overlay, and real-time update
- **Managing** users through a full admin panel with role-based access control

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| **Frontend** | Angular (standalone components, zoneless) | 21 |
| | TypeScript | 5.x |
| | Chart.js + chartjs-plugin-zoom | 4.x / latest |
| | SweetAlert2 (dark-themed dialogs) | latest |
| | STOMP over SockJS (WebSocket client) | @stomp/stompjs |
| **Backend** | Java | 17 |
| | Spring Boot | 4.x |
| | Spring Security + JWT (jjwt 0.12.6) | — |
| | Spring WebSocket (STOMP broker) | — |
| | Spring Kafka (producer + consumer) | — |
| | Spring Data JPA + Hibernate | — |
| **Message Broker** | Apache Kafka (Confluent 7.4) | via Docker |
| | Apache Zookeeper | via Docker |
| **Parser** | Python 3 | 3.8+ |
| **Database** | MySQL | 8 |
| **Infrastructure** | Docker + Docker Compose | — |

---

## 3. Project Structure

```
pfemolka/
│
├── docker-compose.yml              Kafka + Zookeeper containers
│
├── frontend/                       Angular 21 SPA
│   └── src/app/
│       ├── config/
│       │   └── api.config.ts       API_BASE_URL constant
│       ├── guards/
│       │   ├── auth.guard.ts       Redirects unauthenticated users to /login
│       │   └── admin.guard.ts      Restricts /users route to ADMIN role only
│       ├── interceptors/           HTTP interceptors (JWT token attachment)
│       ├── services/
│       │   ├── auth.service.ts     JWT login, logout, role helpers
│       │   ├── user-api.service.ts User CRUD + avatar API calls
│       │   ├── simulator-state.service.ts  Persists simulator state across navigation
│       │   └── dashboard-state.service.ts  Persists dashboard state across navigation
│       ├── login/                  Login page
│       ├── register/               Registration page
│       ├── dashboard/              Log file upload + analysis + charts
│       ├── simulator/              Real-time CAN frame simulator
│       ├── profile/                Profile view/edit + avatar + password change
│       ├── users/                  Admin-only user management table
│       ├── network/                (Network diagnostics view)
│       └── utils/
│           └── swal.ts             Dark-themed SweetAlert2 helpers
│
├── smart-analyzer-backend/         Spring Boot 4 REST + WebSocket + Kafka
│   └── src/main/java/.../
│       ├── config/
│       │   ├── SecurityConfig.java  JWT filter chain, CORS, route permissions
│       │   ├── WebSocketConfig.java STOMP broker + endpoint /ws
│       │   └── ObjectMapperConfig.java Jackson config
│       ├── controller/
│       │   ├── AnalysisController.java   POST /api/analyze, /api/analyze-stream
│       │   ├── UserController.java        Auth + user CRUD + avatar endpoints
│       │   └── FrameController.java       (Frame REST endpoints)
│       ├── simulator/
│       │   ├── SimulationController.java  STOMP @MessageMapping handlers
│       │   ├── SimulationEngine.java      Frame generator → Kafka producer
│       │   ├── CanFrameConsumer.java      Kafka consumer → WebSocket broadcast
│       │   ├── XmlDefinitionLoader.java   Loads CAN signal XML files
│       │   ├── MessageDef.java / SignalDef.java / ValidValue.java  Signal model
│       │   ├── SimulatorFrame.java        DTO for generated frames
│       │   └── SpeedPayload.java          STOMP speed control payload
│       ├── service/
│       │   ├── AnalysisService.java       Spawns Python parser, handles SSE
│       │   └── UserService.java           User business logic, avatar upload
│       ├── security/
│       │   ├── JwtTokenProvider.java
│       │   ├── JwtAuthenticationFilter.java
│       │   └── CustomUserDetailsService.java
│       ├── dto/                    Request/response DTOs
│       ├── entity/                 User, Frame JPA entities
│       ├── repository/             Spring Data repositories
│       └── exception/              Custom exception types
│
├── python_parser/
│   ├── parser.py                   CAN log parser + signal decoder (batch + stream)
│   ├── car_can.xml                 Signal definitions for Car_CAN bus
│   └── key_can.xml                 Signal definitions for Key_CAN bus
│
└── uploads/
    └── avatars/                    User avatar images (created at runtime)
```

---

## 4. Features

### Dashboard — Log File Analysis

| Feature | Details |
|---|---|
| **File upload** | Drag-and-drop or click-to-browse for `.txt` CAN log files |
| **Auto XML discovery** | Backend automatically scans `python_parser/` for all `.xml` signal definition files |
| **Batch mode** | Full file decoded synchronously; all frames returned in one JSON response |
| **Streaming mode (SSE)** | Frames streamed frame-by-frame via Server-Sent Events; table and charts update live |
| **Speed control** | 0.5x / 1x / 2x / 5x / ⚡ (instant) playback delay for streaming mode |
| **Signal table** | Each frame expandable to show all decoded signals with raw value + human label; invalid signals flagged with ⚠ |
| **Step charts** | Chart.js line charts with `stepped: 'before'` — one card per signal group; X-axis = relative seconds from log start |
| **Grouped / Separate** | Toggle between grouping signals with identical state spaces on one chart vs. one chart per signal |
| **Zoom & Pan** | Ctrl+scroll to zoom, drag to pan on X-axis; expand overlay for full-screen |
| **Filters** | Filter table by CAN address, bus name; signal tree checkboxes hide/show chart groups |
| **Export JSON** | Download all decoded frames as a `.json` file |
| **State persistence** | Navigating away and back restores full results (frames, charts, filters) |
| **Error report** | Backend parse errors and invalid signals downloadable as JSON |

### Simulator — Synthetic CAN Traffic

| Feature | Details |
|---|---|
| **Frame generation** | Spring Boot generates synthetic CAN frames from XML signal definitions using random valid values |
| **Kafka pipeline** | Frames published to Kafka topic `can-frames-raw`; consumer broadcasts to WebSocket |
| **WebSocket delivery** | STOMP over SockJS pushes frames to `/topic/frames` in real time |
| **Controls** | Start, Pause, Resume, Stop, Reset — all via STOMP messages |
| **Speed control** | 0.5x / 1x / 2x / 5x / 10x multiplier adjusts inter-frame delay |
| **Table view** | Incoming frames appended to live-updating table with filters |
| **Charts view** | Same step chart system as dashboard — updates in real time as frames arrive |
| **State persistence** | Leaving and returning to the simulator page restores all frames and charts |

### User Management (Admin only)

| Feature | Details |
|---|---|
| **User list** | Paginated table of all users with username, email, role, created date |
| **Create user** | Admin creates accounts with username, email, password, role |
| **Edit user** | Change username, email, or role inline |
| **Delete user** | Permanent deletion with SweetAlert2 confirmation dialog |
| **Role-based access** | `ADMIN` users see the Users page; `USER` role users are redirected |

### Profile Page

| Feature | Details |
|---|---|
| **View profile** | Avatar, username, email, role badge, account creation date |
| **Edit username/email** | Inline field editing with per-field save (pencil → input → Save/Cancel) |
| **Avatar upload** | Click avatar to upload; hover overlay shows camera icon + "CHANGE PHOTO" |
| **Change password** | Collapsible section; requires current password + new password + confirmation |
| **Duplicate detection** | SweetAlert2 error if username/email already taken |

### Authentication

| Feature | Details |
|---|---|
| **JWT login** | `POST /api/users/login` → 24-hour JWT stored in `localStorage` |
| **Registration** | `POST /api/users/register` → creates USER-role account |
| **Route guards** | `authGuard` blocks unauthenticated access; `adminGuard` blocks non-admin from `/users` |
| **HTTP interceptor** | Attaches `Authorization: Bearer <token>` header to every API request |

---

## 5. Architecture

### Full Pipeline Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DASHBOARD — LOG FILE ANALYSIS                      │
│                                                                             │
│  User uploads .txt log file                                                 │
│         │                                                                   │
│         ▼                                                                   │
│  Angular  POST /api/analyze  OR  POST /api/analyze-stream                   │
│         │                              │                                    │
│         │  (batch)                     │  (SSE streaming)                   │
│         ▼                              ▼                                    │
│  Spring Boot                   Spring Boot returns SseEmitter immediately   │
│  saves file to temp dir        saves file to temp dir                       │
│         │                              │                                    │
│         ▼                              ▼                                    │
│  spawns: python3 parser.py     spawns: python3 parser.py --stream           │
│                                                                             │
│  Python reads log line by line, decodes signals using XML bit masks         │
│         │                              │                                    │
│         │  writes decoded_frames.json  │  prints one JSON frame per line    │
│         ▼                              ▼                                    │
│  Spring Boot reads JSON        Spring Boot reads stdout line-by-line        │
│  returns full response         sends each line as SSE event "frame"         │
│         │                              │                                    │
│         ▼                              ▼                                    │
│  Angular maps response         Angular reads ReadableStream                 │
│  → ParsedFrame[]               → appends each frame to table + charts       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          SIMULATOR — REAL-TIME PIPELINE                     │
│                                                                             │
│  Angular STOMP → /app/simulate/start                                        │
│         │                                                                   │
│         ▼                                                                   │
│  SimulationController (@MessageMapping)                                     │
│         │                                                                   │
│         ▼                                                                   │
│  SimulationEngine                                                           │
│  ├─ loads XML definitions (XmlDefinitionLoader)                             │
│  ├─ schedules frame generation every BASE_INTERVAL / speedMultiplier        │
│  └─ publishes SimulatorFrame to Kafka topic: can-frames-raw                 │
│         │                                                                   │
│         ▼                                                                   │
│  Apache Kafka  (Docker — localhost:9092)                                    │
│  topic: can-frames-raw                                                      │
│         │                                                                   │
│         ▼                                                                   │
│  CanFrameConsumer (@KafkaListener)                                          │
│  └─ SimpMessagingTemplate.convertAndSend("/topic/frames", frame)            │
│         │                                                                   │
│         ▼                                                                   │
│  Spring WebSocket (STOMP over SockJS — ws://localhost:8082/ws)              │
│         │                                                                   │
│         ▼                                                                   │
│  Angular STOMP subscriber → /topic/frames                                   │
│  └─ onFrameReceived() → table row + chart data point                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          AUTHENTICATION FLOW                                │
│                                                                             │
│  Angular login form                                                         │
│         │  POST /api/users/login { username, password }                     │
│         ▼                                                                   │
│  Spring Security (UserDetailsService + BCrypt)                              │
│         │  returns { token, username, role }                                │
│         ▼                                                                   │
│  Angular stores JWT in localStorage                                         │
│         │  HTTP interceptor attaches: Authorization: Bearer <token>         │
│         ▼                                                                   │
│  JwtAuthenticationFilter validates token on every request                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. How to Run Locally

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Java JDK | 17 | Set `JAVA_HOME` |
| Node.js | 18+ | npm included |
| Python | 3.8+ | Must be on `PATH` as `python3` |
| Docker Desktop | latest | For Kafka + Zookeeper |
| MySQL | 8 | Running on port 3306 |

---

### Step 1 — Start Kafka (Docker)

```bash
# From project root
docker-compose up -d
```

Starts Zookeeper (port `2181`) and Kafka (port `9092`).

To verify Kafka is ready:
```bash
docker logs smart-analyzer-kafka 2>&1 | tail -5
# Should show: [KafkaServer] started
```

---

### Step 2 — Create the MySQL Database

```sql
CREATE DATABASE IF NOT EXISTS smart_analyzer_db;
```

The schema is auto-created by Spring Boot on first run (`ddl-auto=update`).

> **Note:** Default credentials in `application.properties` are `root` / `root123mallajaw`. Change these for any non-local deployment.

---

### Step 3 — Start the Spring Boot Backend

```bash
cd smart-analyzer-backend
./mvnw spring-boot:run
```

Backend starts on **http://localhost:8082**.

On first boot, create an admin account via the register endpoint or directly in MySQL:
```sql
-- After running once so the table exists:
UPDATE users SET role = 'ADMIN' WHERE username = 'your_username';
```

---

### Step 4 — Install Python Dependencies

The parser uses only the standard library — no `pip install` required.

Verify the parser works standalone:
```bash
# Batch decode
python3 python_parser/parser.py "python_parser/log file.txt"

# Streaming decode (prints one JSON per line)
python3 python_parser/parser.py --stream "python_parser/log file.txt"
```

---

### Step 5 — Start the Angular Frontend

```bash
cd frontend
npm install
npm start
# or: npx ng serve --open
```

Frontend starts on **http://localhost:4200**.

---

### Configuration Files

**`frontend/src/app/config/api.config.ts`**
```typescript
export const API_BASE_URL = 'http://localhost:8082';
```

**`smart-analyzer-backend/src/main/resources/application.properties`**
```properties
server.port=8082

# MySQL
spring.datasource.url=jdbc:mysql://localhost:3306/smart_analyzer_db?createDatabaseIfNotExist=true&useSSL=false&serverTimezone=UTC&allowPublicKeyRetrieval=true
spring.datasource.username=root
spring.datasource.password=root123mallajaw

# JWT
jwt.secret=ChangeMeToAVeryLongSecretKeyAtLeast32BytesLongForHS256Algorithm
jwt.expiration-ms=86400000

# File upload
spring.servlet.multipart.max-file-size=5MB
spring.servlet.multipart.max-request-size=5MB

# Simulator XML definitions
simulator.definitions-dir=../python_parser

# Kafka
spring.kafka.bootstrap-servers=localhost:9092
spring.kafka.consumer.group-id=can-analyzer
```

---

## 7. API Endpoints

### Authentication & User Management — `/api/users`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/users/register` | Public | Create a new USER-role account |
| `POST` | `/api/users/login` | Public | Authenticate, receive JWT token |
| `GET` | `/api/users/me` | Any authenticated | Get current user's profile |
| `PUT` | `/api/users/me` | Any authenticated | Update username, email, or password |
| `POST` | `/api/users/me/avatar` | Any authenticated | Upload avatar image (`multipart/form-data`) |
| `GET` | `/api/users/avatars/{filename}` | Public | Serve avatar image file |
| `GET` | `/api/users` | ADMIN only | List all users |
| `POST` | `/api/users` | ADMIN only | Create a user (any role) |
| `PUT` | `/api/users/{id}` | ADMIN only | Update any user's details |
| `DELETE` | `/api/users/{id}` | ADMIN only | Delete a user |

### Log File Analysis — `/api`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/analyze` | Any authenticated | Batch decode — returns `{ frames, errorReport, totalFrames, xmlFilesUsed }` |
| `POST` | `/api/analyze-stream` | Any authenticated | SSE stream — emits `frame`, `errors`, and `end` events |

### Simulator — WebSocket STOMP

Connect to: `ws://localhost:8082/ws` (SockJS fallback)

| Destination (client sends) | Description |
|---|---|
| `/app/simulate/start` | Start frame generation |
| `/app/simulate/pause` | Pause generation |
| `/app/simulate/resume` | Resume after pause |
| `/app/simulate/stop` | Stop generation |
| `/app/simulate/reset` | Reset and clear all state |
| `/app/simulate/speed` | Set speed multiplier `{ "multiplier": 2.0 }` |

| Topic (client subscribes) | Description |
|---|---|
| `/topic/frames` | Broadcast of each generated `SimulatorFrame` as JSON |

---

## 8. Signal Definitions (XML Format)

XML files in `python_parser/` define all known CAN messages and signals. The backend auto-discovers all `.xml` files in that directory — no configuration needed to add a new bus.

### File Structure

```xml
<Bus Name="Car_CAN">
  <massage name="Car_Status" id="0x2FC">
    <Byte>
      <Num>0</Num>                          <!-- byte index (0-based) -->
      <Signal Bit="xxxx1111">               <!-- bit mask within the byte -->
        <signal_name>door_latch_status</signal_name>
        <values><value>1</value><n>Unlocked</n></values>
        <values><value>2</value><n>Locked</n></values>
        <values><value>4</value><n>Secured</n></values>
      </Signal>
      <Signal Bit="xx11xxxx">
        <signal_name>selective_unlock_status</signal_name>
        <values><value>0</value><n>off</n></values>
        <values><value>1</value><n>on</n></values>
      </Signal>
    </Byte>
  </massage>
</Bus>
```

> **Note:** The tag is spelled `<massage>` (not `<message>`) in the source XML files. The parser and backend handle this as-is.

### Bit Pattern Syntax

The `Bit` attribute is an 8-character mask per byte where:
- `1` = this bit is part of the signal
- `x` = ignored

| Pattern | Bits | Mask | Shift |
|---|---|---|---|
| `xxxx1111` | lower 4 bits | `0x0F` | 0 |
| `xx11xxxx` | bits 4–5 | `0x30` | 4 |
| `11xxxxxx` | upper 2 bits | `0xC0` | 6 |
| `xxxxxxx1` | bit 0 only | `0x01` | 0 |

**Decoding formula:**
```python
extracted = (byte_value & mask) >> shift
label = state_map[extracted]   # from XML <values>/<n>
```

### Adding a New Signal File

1. Create `python_parser/my_new_bus.xml` following the format above
2. Restart the Spring Boot backend (it reloads definitions on startup)
3. The new bus's signals automatically appear in Dashboard and Simulator

### Current Signal Files

**`car_can.xml`** — Bus: Car_CAN

| Message | ID | Signals |
|---|---|---|
| Car_Status | `0x2FC` | door_latch_status, selective_unlock_status, Drd_Status, PSD_Status, DRDR_Status, Psdr_Status, Bootlid_Status, Rocker_switch_Status |
| Key_Button_Status | `0x23A` | Unlock_Button_status, Lock_Button_status, 3rd_Button_status |
| Contact_Status | `0x2CA` | Drd_Status_Cont, PSD_Status_Cont, DRDR_Status_Cont, Psdr_Status_Cont, Bootlid_Status_Cont |
| Latch_Action | `0x2AF` | 12 latch action signals (secure/lock/unlock per door) |
| Door_selective_unlock | `0xFFF` | selective_unlock_action, Roc_Switch |

**`key_can.xml`** — Bus: Key_CAN

| Message | ID | Signals |
|---|---|---|
| key_comm | `0x723` | KEY_Pos, KEY_Butt, Key_ID (32-bit numeric, excluded from charts) |

### Log File Format

```
date Wed Mar 11 13:07:53 2026
CAN 1: Car_CAN
CAN 2: Key_CAN
1773230879.890181  2  0x2FC  Rx  d  8  [1, 0, 0, 0, 0, 0, 0, 0]
1773230880.164613  2  0x23A  Rx  d  8  [0, 0, 0, 0, 0, 0, 0, 0]
```

| Field | Description |
|---|---|
| `unix_timestamp` | Absolute Unix epoch with microsecond precision |
| `channel` | CAN bus channel number (1 = Car_CAN, 2 = Key_CAN) |
| `hex_id` | CAN message ID, e.g. `0x2FC` |
| `direction` | `Rx` (received) or `Tx` (transmitted) |
| `dlc` | Data Length Code — number of bytes in the frame |
| `[bytes]` | Comma-separated decimal byte values |

---

## 9. Roadmap

| Phase | Feature | Status |
|---|---|---|
| **Done** | Log file upload + batch decode | ✅ |
| **Done** | SSE streaming mode with speed control | ✅ |
| **Done** | Step charts with zoom/pan (Chart.js) | ✅ |
| **Done** | Kafka-backed simulator with WebSocket | ✅ |
| **Done** | JWT authentication + role-based access | ✅ |
| **Done** | User management CRUD (admin panel) | ✅ |
| **Done** | Profile page with avatar, inline edit, password change | ✅ |
| **Done** | State persistence across navigation | ✅ |
| **Planned** | **3D vehicle simulation** — Unity WebGL integration; door/lock states reflected on 3D model | 🔲 |
| **Planned** | **Real CAN hardware** — Python reads from USB CAN interface (PEAK PCAN, SocketCAN) instead of log file | 🔲 |
| **Planned** | **InfluxDB time-series storage** — persist all decoded frames for long-term analysis and playback | 🔲 |
| **Planned** | **Full Docker deployment** — single `docker-compose up` starts everything (Angular, Spring Boot, MySQL, Kafka) | 🔲 |
| **Planned** | **Anomaly detection** — flag unexpected signal transitions, timing violations, undefined raw values | 🔲 |
| **Planned** | **Synchronized crosshair** — hover on one chart draws a vertical marker on all charts at the same timestamp | 🔲 |
| **Planned** | **Multi-bus filtering** — filter table and charts by CAN channel (CAN 1 / CAN 2) | 🔲 |

---

*Smart Real-Time CAN Analyzer — Molka Elleuch — KPIT Technologies PFE*
