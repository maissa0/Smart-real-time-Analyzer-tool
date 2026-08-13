# KPIT Smart Real-Time CAN Analyser

End-to-end web platform for live and recorded CAN traffic: decode, analyse integrity, visualize signals, and manage sessions, vehicles, and ECU catalogs.

## What is this?

### CAN bus and why it matters in automotive

The Controller Area Network (CAN) is the dominant in-vehicle bus for ECUs. Messages carry safety- and diagnostics-critical data across powertrain, chassis, body, and infotainment domains. Reliable capture, decoding, and monitoring of CAN frames underpins calibration, troubleshooting, validation, and homologation support.

### The problem this tool solves

Teams need one place to stream or replay CAN traffic, decode it against OEM-style XML catalogs, persist frames and time-series efficiently, analyse signal integrity faults, and explore data in the browser—with an auditable backend and repeatable pipeline—not ad-hoc scripts and disparate tools.

### Who it is for

- Automotive engineers validating behaviour on the bench or in the field  
- ECU developers integrating stacks and diagnosing bus-level issues  
- Embedded systems teams that own capture, tooling, and data pipelines  

## Features

### Live CAN Simulation (random + replay mode, fault injection, configurable frequency)

Synthetic or replayed traffic at tunable rates, optional fault injection, for repeatable tests without hardware.

### Real-Time Frame Decoding (XML ECU catalogs, Kafka pipeline, Python decoder)

Raw frames flow through Kafka; the Python decoder applies XML catalogs and emits structured decoded output for downstream services.

### Live WebSocket Streaming (STOMP, real-time charts, pipeline counter)

Browsers subscribe over STOMP (SockJS) for live frames and KPIs—charts update as data arrives alongside pipeline/session counters.

### Session Management (LIVE/COMPLETE badges, filters, vehicle linking, CSV export)

Organize captures with lifecycle badges, filtering, linkage to vehicles, and export of frame data where supported.

### Log File Upload (.asc .blf .log .txt, async processing, car linking)

Ingest heterogeneous log formats asynchronously, tie uploads to fleet cars, and process through the same pipeline backbone.

### Signal Chart Visualization (step-line charts, InfluxDB replay, play/pause/seek/speed)

Step-style signal plots backed by time-series storage; interactive playback controls for offline review.

### Frame Table (paginated, filterable, exportable)

Large session views with paging, filtering, and export pathways for spreadsheets and tooling.

### Integrity Analysis (timing gaps, counter errors, signal range violations)

Rules and summaries for anomalies such as periodicity gaps, counter inconsistencies, and out-of-range enumerations/numerics relative to catalogs.

### ECU Catalog Management (XML upload, message/signal tree view)

Maintain XML catalogs (upload/delete/reload), browse message and signal hierarchies aligned with decoding.

### Fleet Management (vehicle registry, session linking)

Register cars and associate CAN sessions/uploads with the correct vehicle context.

### User Management & Auth (JWT, RBAC, audit logging)

JWT-backed API access with role-aware behaviour and auditing for security-sensitive actions.

## Architecture

```text
   can_simulator.py (10Hz)
        ↓ Kafka: raw-can-frames
   decoder.py
        ↓ Kafka: decoded-signals
   CanKafkaConsumer.java
        ↓                    ↓
   MySQL (can_frames)   InfluxDB (can_signals)
        ↓
   WebSocket /topic/frames/{sessionId}
        ↓
   Angular (charts + table)
```

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | Angular 21 Zoneless + Chart.js |
| Backend | Spring Boot 3.4.1 (Java 17) |
| Broker | Apache Kafka 3.8 KRaft (Docker) |
| Time-Series | InfluxDB 2.7 (Docker) |
| Database | MySQL 8 |
| Pipeline | Python 3.12 |
| Real-Time | STOMP WebSocket via SockJS |

## Getting Started

### Prerequisites

- Java 17  
- Python 3.12  
- Node.js 20+  
- Docker  
- MySQL  

### Backend

```bash
cd backend && mvn spring-boot:run
```

### Frontend

```bash
cd Frontend_angular && npm install && ng serve
```

### Python pipeline

```bash
cd python_parser && pip install -r requirements.txt && python pipeline.py
```

### Kafka + InfluxDB

```bash
docker-compose up -d
```

## Project Structure

```text
Kpit_c/
├── backend/          Spring Boot API
├── Frontend_angular/ Angular 21 UI
├── python_parser/    CAN decoder + simulator
│   └── catalogues/   XML ECU catalog files
├── uploads/          Uploaded log files
└── docker-compose.yml
```

## Internship Context

Developed as a PFE (Projet de Fin d'Études) internship project at KPIT Technologies. The platform demonstrates end-to-end integration of automotive CAN bus analysis with modern full-stack web technologies.
