# `simulator-state.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/simulator-state.service.ts`

---

## Executive Summary

`SimulatorStateService` tracks **which CAN simulator instance is active** (`simId`) and whether it is **running** (`isRunning`) via Angular signals. UI components read/write this shared state when starting/stopping the Python `can_simulator.py` via backend simulator endpoints.

**Business value:** Coordinates simulator controls across sniffer/toolbar without prop-drilling.

---

## Architectural Process Orchestration

```
Sniffer / Simulator toolbar
        ▼
SimulatorStateService.setSimId / setRunning
        ▼
(Parallel) HTTP to SimulatorController — actual start/stop in component/service caller
        ▼
Python can_simulator → Kafka → backend consumer → WebSocket frames
        ▼
LiveTelemetryService receives frames on STOMP
```

This service **does not call HTTP**—only holds UI coordination state.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `simId` | Readonly signal `string \| null` |
| `isRunning` | Readonly signal `boolean` |
| `setSimId(id)` | Assign active simulator ID |
| `setRunning(running)` | Toggle running flag |
| `reset()` | Clear both signals |

---

## Critical Design Considerations

- **Minimal state holder** — business logic lives in components calling `CanService` or direct simulator API.
- **Signal-based** — works with zoneless change detection.

---

## Gotchas & Best Practices

- **State can desync** from backend if simulator crashes—refresh from API on route enter.
- Must **reset on logout** or session change to avoid stale simId.

---

## Architectural Advice & Refactoring

**Add:** Poll or WebSocket hook to sync `isRunning` from backend truth. **Correct:** Wire reset in auth logout. **Remove:** Nothing unless merged into a broader "session workspace" store.

---

## Navigation Strategy

Next: sniffer simulator controls, backend `SimulatorController.java`, `python_parser/can_simulator.py`.
