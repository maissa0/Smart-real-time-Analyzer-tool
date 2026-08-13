# `replay-engine.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/replay-engine.service.ts`

---

## Executive Summary

`ReplayEngineService` drives **server-side Influx replay UI timing**: after `CanService.startPlayback`, it consumes `LiveTelemetryService.playback$` points and runs a **16ms interval clock** with play/pause/seek and speed control—mirroring a media player for time-series replay.

**Business value:** Synchronizes charts, gauges, and frame tables to historical telemetry streamed from InfluxDB through the backend—not local `CanFrame[]` arrays.

---

## Architectural Process Orchestration

```
User starts replay
        ▼
CanService.startPlayback(sessionId)
        ▼
LiveTelemetryService.subscribeToPlayback(sessionId)
        ▼
ReplayEngineService.loadPoints / play / pause / seek
        ▼
16ms setInterval tick → currentTime signal, visible point window
        ▼
Replay UI components (charts, timeline slider)
```

Distinct from **`TelemetryService`** (local frame array RAF playback).

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `state`, `speed`, `currentTime`, `duration` | Playback signals |
| `visiblePoints` | Computed slice up to playhead |
| `loadPoints(points)` | Buffer Influx playback messages |
| `play()` / `pause()` / `stop()` | Control interval tick |
| `seekTo(time)` / `setSpeed(n)` | Scrub and speed |
| `progress` | Computed 0–1 ratio |

Tick advances `currentTime` by elapsed × speed until `duration`.

---

## Critical Design Considerations

- **Interval-based** (16ms) vs RAF in `TelemetryService` — different timing models.
- **Depends on playback$ payload shape** — must match backend Influx point JSON.
- **Buffer in memory** — long replays may need downsampling.

---

## Gotchas & Best Practices

- Must **stop interval** on destroy to prevent leaks.
- If WebSocket drops mid-replay, clock may run ahead of incoming points.
- Coordinate **only one active replay** session globally.

---

## Architectural Advice & Refactoring

**Add:** Backpressure when points arrive faster than tick. **Correct:** Unify seek API with `TelemetryService` if UX merges live/historical. **Remove:** Duplicate speed constants across services.

---

## Navigation Strategy

Next: `can.service.ts` `startPlayback`, `live-telemetry.service.ts`, backend `PlaybackService.java`, Influx query layer.
