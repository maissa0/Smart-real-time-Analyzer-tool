# `can.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/can.service.ts`

---

## Executive Summary

`CanService` is the **primary HTTP gateway for CAN domain data**: sessions, frames, cars/fleet, integrity faults, log upload, and playback start. It connects the Angular sniffer, fleet, dashboard, and replay features to Spring Boot `/api/can`, `/api/logs`, and `/api/playback`.

**Business value:** Centralizes all REST access to the real-time CAN pipeline's persisted state (MySQL) and orchestration endpoints (playback, upload).

---

## Architectural Process Orchestration

```
Sniffer / Fleet / Dashboard / Replay UI
        ▼
CanService (HttpClient + API_BASE_URL)
        ▼
Spring CanController, CarController, LogUploadController, PlaybackController, IntegrityController
        ▼
MySQL (sessions, frames, cars) + optional Kafka/Influx side effects on upload/start
        ▼
(Live path) LiveTelemetryService STOMP — not this service
```

**Upload flow:** `uploadLog` → backend stores file → Python/Kafka pipeline (when configured).

**Replay flow:** `startPlayback(sessionId)` → backend streams via WebSocket topic `/topic/playback/{id}`.

---

## Key Controller/Service Capabilities

| Area | Methods | Backend |
|------|---------|---------|
| Sessions | `getSessions`, `getSession`, `deleteSession` | `/api/can/sessions` |
| Frames | `getFrames(sessionId, page?, size?)` | `/api/can/sessions/{id}/frames` |
| Fleet | `getCars`, `createCar`, `updateCar`, `deleteCar` | `/api/cars` |
| Integrity | `getIntegrityFaults(sessionId)` | `/api/can/sessions/{id}/integrity` |
| Logs | `uploadLog(file, carId?)` | `POST /api/logs/upload` |
| Playback | `startPlayback(sessionId)` | `POST /api/playback/start` |
| Dashboard | `getDashboardStats()` | `/api/dashboard/stats` |

Uses typed models from `data/models/` where defined.

---

## Critical Design Considerations

- **Large payloads** — frame pagination params matter for sniffer performance.
- **Multipart upload** — `FormData` with file + optional `carId`.
- **Root singleton** — shared across feature modules.

---

## Gotchas & Best Practices

- **401 on catalog-like routes** — CAN routes require auth; ensure token present.
- **Playback vs TelemetryService** — REST starts server replay; local frame scrub uses `TelemetryService`.
- Verify **page indexing** (0 vs 1) matches backend for `getFrames`.

---

## Architectural Advice & Refactoring

**Add:** Streaming or cursor pagination for huge sessions. **Correct:** Unify car API path prefix if backend moves under `/api/can`. **Remove:** Duplicate stats calls from components—cache in store if needed.

---

## Navigation Strategy

Next: `live-telemetry.service.ts`, `features/sniffer/`, backend `CanController.java`, `PlaybackController.java`.
