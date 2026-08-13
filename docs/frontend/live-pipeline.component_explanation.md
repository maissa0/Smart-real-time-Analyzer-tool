# `live-pipeline.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/live-pipeline/live-pipeline.component.ts`

---

## Executive Summary

`LivePipelineComponent` shows a **4-stage live pipeline dashboard** (Simulator → WS → MySQL → InfluxDB) during live CAN sessions. It animates WebSocket frame counts from `LiveTelemetryService` and polls **`GET /api/can/sessions/{id}/pipeline-stats`** every 3s for MySQL/Influx totals.

**Business value:** Demo/jury visualization of end-to-end latency across Python → Kafka → Java → storage.

---

## Architectural Process Orchestration

```
Live session selected in Sniffer
        ▼
app-live-pipeline [sessionId]
        ▼
liveTelemetry.frameCount → wsFrames (animated)
        ▼
Poll pipeline-stats → mysqlFrames, influxPoints
        ▼
Progress bars vs maxFrames computed
```

---

## Key Controller/Service Capabilities

| Signal | Source |
|--------|--------|
| `wsFrames` | Smoothed toward `liveTelemetry.frameCount()` |
| `mysqlFrames` | API poll |
| `influxPoints` | API poll |
| `elapsedTime` | 1s clock from init |
| `fps` | wsFrames / elapsed |

Input: `sessionId`.

---

## Critical Design Considerations

- **Simulator stage** currently mirrors WS count (100% bar)—not independent metric.
- **Three timers** on init—must clear on destroy (implemented).

---

## Gotchas & Best Practices

- Poll silently fails if endpoint missing—bars stay at zero.
- Manual Bearer header duplicate.
- Shown only when `isLiveSession()` in parent template.

---

## Architectural Advice & Refactoring

**Add:** Use `CanService` wrapper; reset counters on session change. **Remove:** Unused `_animTimer` mysql comment block dead logic.

---

## Navigation Strategy

Next: backend pipeline-stats endpoint, `LiveTelemetryService`, `sniffer.component.html`.
