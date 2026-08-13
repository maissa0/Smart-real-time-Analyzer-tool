# `can.model.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/models/can.model.ts`

---

## Executive Summary

`can.model.ts` defines **TypeScript interfaces and one helper** for the CAN analyser domain: sessions, decoded frames, integrity faults, and summary stats. It mirrors Spring Boot REST/WebSocket payloads for sniffer, workspace, telemetry, and replay features.

**Business value:** Type-safe contract between Java backend (MySQL + Kafka pipeline) and Angular UI for all CAN log inspection workflows.

---

## Architectural Process Orchestration

```
Python decoder / Kafka → Java CanSessionService
        ▼
REST: GET /api/can/sessions, /frames, /integrity
WebSocket: /topic/frames/{sessionId}
        ▼
CanService / LiveTelemetryService deserialize JSON
        ▼
CanSession | CanFrame | IntegrityFault | IntegritySummary
        ▼
SnifferComponent, FrameTable, TelemetryService, CanWorkspace
        ▼
parseSignals(frame.signals) → DecodedSignal[] for UI charts
```

Not exported from `data/models/index.ts`—direct import only.

---

## Key Controller/Service Capabilities

| Type / function | Fields / behavior |
|-----------------|-------------------|
| `CanSession` | `id`, `sessionId`, `sourceFilename`, `startTs`/`endTs`, `frameCount`, `status` |
| `CanFrame` | `timestamp`, `channel`, `msgId`, `msgName`, `direction`, `rawBytes`, `signals` (JSON string) |
| `DecodedSignal` | `signal_name`, `raw_value`, `label` — parsed from `signals` |
| `parseSignals(json)` | Safe `JSON.parse`; returns `[]` on failure |
| `IntegrityFault` | `faultType`: `DUPLICATE` \| `TIMING_GAP` \| `SIGNAL_RANGE` |
| `IntegritySummary` | Aggregated counts + `healthy` flag |

---

## Critical Design Considerations

- **`signals` is a string, not an array** — backend stores JSON text; UI must call `parseSignals`.
- **Timestamps as numbers** — epoch ms for frames; ISO strings for `createdAt` on sessions/faults.
- **`msgId` as string** — hex IDs preserved as strings (e.g. `"0x123"`).
- **Only runtime export** in models folder — `parseSignals()` function.

---

## Gotchas & Best Practices

- WebSocket frames may need **normalization** in `sniffer.component.ts` before matching `CanFrame`.
- `IntegritySummary` may come from a separate endpoint or be computed client-side—verify backend contract.
- Large sessions: holding `CanFrame[]` in signals can stress memory—pagination is service-level concern.
- `CanSession.status` optional—handle null in session list UI.

---

## Architectural Advice & Refactoring

**Add:** Barrel export; typed enum for `faultType`; `signals` as `DecodedSignal[]` if backend can emit structured JSON. **Correct:** Align live WS payload shape with REST frame DTO. **Remove:** Duplicate ad-hoc frame types in components.

---

## Navigation Strategy

Next: `can.service_explanation.md`, `telemetry.service_explanation.md`, `sniffer.component.ts`, backend `CanFrameResponse.java`.
