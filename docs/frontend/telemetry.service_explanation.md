# `telemetry.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/telemetry.service.ts`

---

## Executive Summary

`TelemetryService` is a **client-side playback engine for in-memory `CanFrame[]` arrays**—not live WebSocket traffic. It manages play/pause/stop, speed, seek, and computed playhead position using `requestAnimationFrame`, exposing signals for frame table/chart slicing during **offline or loaded-session** review.

**Business value:** Decouples UI playback timing from network; lets sniffer/workspace scrub through frames already fetched from MySQL via REST.

---

## Architectural Process Orchestration

```
CanService.getFrames(sessionId)  →  CanFrame[]
        ▼
TelemetryService.loadSession(frames)
        ▼
play() / pause() / seekTo()  →  playbackIndex, playheadTimestamp signals
        ▼
Sniffer / workspace components read visibleFrames, progress, sliderValue
```

**Separate from Influx replay:** `ReplayEngineService` + `LiveTelemetryService.playback$` handle **server-streamed** Influx points; this service handles **frame-array** playback.

**Live append:** `appendLiveFrame()` extends buffer during live STOMP ingestion.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `frames`, `playbackIndex`, `state`, `speed` | Readonly signals |
| `visibleFrames` | Computed slice `[0..playbackIndex]` |
| `progress`, `currentTime`, `totalTime`, `sliderValue` | Playhead UI metrics |
| `loadSession(frames)` | Reset buffer and show full session |
| `appendLiveFrame(frame)` | Push live frame; update playhead if stopped |
| `play()` / `pause()` / `stop()` | Playback control |
| `seekTo(index)` / `seekToPlayhead(linear)` | Frame or log-time seek |
| `setSpeed(speed)` | Speed multiplier for RAF tick |

Private `tick()` uses wall clock × speed vs frame timestamps.

---

## Critical Design Considerations

- **Signal-based state** — zoneless-friendly; no HttpClient.
- **RAF loop** — smooth playhead; stops at last frame.
- **Stopped state shows full session** — `stop()` sets index to last frame (full view), not index 0.

---

## Gotchas & Best Practices

- **Two playback systems** in app (`TelemetryService` vs `ReplayEngineService`) — easy to confuse; document which feature uses which.
- **`_timer` unused** in practice — RAF used; dead field.
- Large frame arrays — slicing in computed may be heavy for 100k+ frames.

---

## Architectural Advice & Refactoring

**Add:** Max frame cap or virtual window. **Correct:** Remove unused `_timer` or use consistently. **Remove:** Consider merging with `ReplayEngineService` if overlap grows.

---

## Navigation Strategy

Next: `replay-engine.service.ts`, `live-telemetry.service.ts`, `sniffer.component.ts` playback methods.
