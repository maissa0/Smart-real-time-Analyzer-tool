# `simulator-control.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/simulator/simulator-control.component.ts`

---

## Executive Summary

`SimulatorControlComponent` controls the **Python CAN simulator** via `/api/simulator`: start/stop, mode (random/replay), frequency, fault injection options, vehicle link. Updates **`SimulatorStateService`** and emits started/stopped events to parent.

**Business value:** Generates live `live_simulation` sessions for demo and testing integrity analyzer.

---

## Architectural Process Orchestration

```
User configures mode, Hz, faults, vehicle
        ▼
POST /api/simulator/start
        ▼
Python can_simulator → Kafka → backend → WS frames
        ▼
simulatorState.setRunning(simId)
        ▼
simulatorStarted → Sniffer reloads sessions / live connect
        ▼
Poll GET /api/simulator/status every 2s while running
        ▼
POST /api/simulator/stop/{id}
```

---

## Key Controller/Service Capabilities

| Config | Maps to API body |
|--------|------------------|
| `mode` | random / replay + logFile |
| `frequency` | speed = Hz/10 |
| Fault checkboxes | injectTimingGaps, injectCounterErrors, injectValueErrors, faultRate |
| `selectedCarUid` | carUid |

Outputs: `simulatorStarted`, `simulatorStopped`.

---

## Critical Design Considerations

- **Default log path** hard-coded Windows path.
- **Raw HttpClient** + manual Bearer.
- Inline template (~120 lines styles).

---

## Gotchas & Best Practices

- `loop` field exists but no UI checkbox wired in template snippet (field on class).
- Stop errors still call `setStopped()`.
- Used from workspace with `[hideSimulator]` on embedded sniffer.

---

## Architectural Advice & Refactoring

**Add:** Configurable log path; use SimulatorService facade. **Remove:** Hard-coded paths from defaults.

---

## Navigation Strategy

Next: `SimulatorStateService`, backend `SimulatorController`, `live-pipeline.component_explanation.md`.
