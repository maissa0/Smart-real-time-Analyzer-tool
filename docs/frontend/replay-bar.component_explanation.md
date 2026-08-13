# `replay-bar.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/replay-bar/replay-bar.component.ts`

---

## Executive Summary

`ReplayBarComponent` is the **Influx replay transport UI**: play/pause/resume/stop, speed presets, time slider, and status badges. It injects **`ReplayEngineService`** directly and emits `playRequested` / `stopRequested` for parent to start/stop backend playback.

**Business value:** Unified replay controls for signal charts on completed (non-live) sessions.

---

## Architectural Process Orchestration

```
Sniffer template → app-replay-bar
        ▼
playRequested → SnifferComponent.onReplayPlay() → CanService.startPlayback + WS playback$
        ▼
ReplayEngineService.play/pause/seek/skip/setSpeed
        ▼
Charts sync via replay engine clock + RAF in sniffer
```

Slider calls `replay.seek()` locally and emits `seekRequested`.

---

## Key Controller/Service Capabilities

| Member | Role |
|--------|------|
| `replay` | Injected `ReplayEngineService` |
| `playRequested` / `stopRequested` / `seekRequested` | Outputs to parent |
| Speed buttons | 0.1x–4x |
| Skip | ±5s via `replay.skip()` |

States: `idle`, `loading`, `playing`, `paused`.

---

## Critical Design Considerations

- **Does not start playback alone** — parent must call API on `playRequested`.
- **Inline template/styles** — standalone dumb UI around shared service.

---

## Gotchas & Best Practices

- Shared singleton `ReplayEngineService`—only one replay session globally.
- `seekRequested` emitted but parent may also rely on service state directly.

---

## Architectural Advice & Refactoring

**Add:** Disable bar when no session selected (parent responsibility). **Remove:** Nothing.

---

## Navigation Strategy

Next: `replay-engine.service_explanation.md`, `sniffer.component.ts` `startInfluxPlayback`.
