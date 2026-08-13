# `sniffer.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/sniffer.component.ts`

---

## Executive Summary

`SnifferComponent` is the **central CAN inspection orchestrator** (~1,400 lines): session selection, MySQL frame loading, live WebSocket streaming, Chart.js signal timelines, integrity faults, and InfluxDB server-side replay. It is mounted at `/admin/sniffer` and **embedded** in `CanWorkspaceComponent` with `@Input()` hooks for filters and layout flags.

**Business value:** Single brain for table/charts/integrity views—the core product surface for CAN log analysis.

---

## Architectural Process Orchestration

```
Route /admin/sniffer OR CanWorkspace embed
        ▼
ngOnInit: queryParams sessionId → loadSessions → selectSession
        ▼
selectSession(session)
  ├─ loadFrames (MySQL via CanService)
  ├─ loadIntegrity
  ├─ isLive? → LiveTelemetryService.connect + RAF chart loop
  └─ else → TelemetryService playback index for table scrub
        ▼
Live path: frames$ → ring buffer (2000) → RAF → SignalChart.appendPoint
Historical charts: signalTimelines computed from allFrames + telemetry index
Replay path: onReplayPlay → startInfluxPlayback → WS points → ReplayEngineService tick/seek
        ▼
Tabs: table | charts | integrity (activeTab signal)
```

**Deep link:** `?sessionId=` merged into URL on selection.

---

## Key Controller/Service Capabilities

| Dependency | Role |
|------------|------|
| `CanService` | Sessions, frames, integrity, playback start/stop, CSV export |
| `LiveTelemetryService` | STOMP frames + session status + playback stream |
| `TelemetryService` | Local frame index, live append, seek for table sync |
| `ReplayEngineService` | Play/pause/seek UI state for Influx replay |
| `ToastService` | Delete/upload feedback |

| Signal cluster | Purpose |
|----------------|---------|
| `sessions`, `selectedSession`, `filteredSessions` | Session list + live/upload filters |
| `allFrames`, `filteredVisibleFrames` | Table data + filters (msgId, bus, faults, visibility) |
| `isLiveSession`, `_frameBuffer` | Live mode + O(1) ring buffer |
| `liveChartGroups`, `signalTimelines` | Chart dataset bindings |
| `playbackPoints`, `playbackActive` | Influx replay buffer |
| `integritySummary`, `integrityFaults` | Integrity tab |

**Embed inputs:** `hideUpload`, `hideSimulator`, `liveOnly`, `uploadOnly`, `autoSelectLive`, `externalMsgId`, `externalBusFilter`, `externalFaultsOnly`, `externalAnomalyOnly`, `externalVisibleMessages`, `externalVisibleSignalNames`, `kpitMonitorChartTheme`.

---

## Critical Design Considerations

- **Performance:** Live frames batched via `requestAnimationFrame` (max ~10 chart updates/s, 150 points/batch); avoids O(n²) signal updates per Kafka message.
- **Dual playback:** `TelemetryService` for MySQL frame scrubbing; **Influx stream** + `ReplayEngineService` for chart replay on completed sessions.
- **Live detection:** `live_simulation` + status not `COMPLETE` (null/LIVE/empty treated as live).
- **10s silence:** Live ticker stops and flips `isLiveSession` false if no frames for 10s.
- **OnPush + signals:** Heavy use of `computed()` for derived chart/table state.

---

## Gotchas & Best Practices

- **Monolith:** Session sidebar logic duplicated with `SessionListComponent` and `CanWorkspaceComponent`; standalone `/admin/sniffer` template has **no left panel** (styles legacy in SCSS).
- **Manual Bearer** in `loadCars()` despite `CanService` elsewhere.
- **Chart tab flip:** Auto-switches to charts on live data—can surprise users on table-first workflow.
- **Replay stop:** Toggles tab table→charts to force Chart.js re-init.
- **`SessionListComponent` imported** but may not appear in `sniffer.component.html`—partial extraction.

---

## Architectural Advice & Refactoring

**Add:** Sniffer store (sessions, selected, filters); delegate sidebar to workspace or restore layout wrapper. **Split:** Live pipeline, replay, integrity into facades or child containers. **Remove:** Dead `kpit-sniffer-layout` path or restore for standalone route.

---

## Navigation Strategy

Next: `sniffer.component.html`, `can-workspace.component_explanation.md`, `can.service_explanation.md`, `live-telemetry.service_explanation.md`, `replay-engine.service_explanation.md`.
