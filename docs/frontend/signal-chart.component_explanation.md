# `signal-chart.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/signal-chart/signal-chart.component.ts`

---

## Executive Summary

`SignalChartComponent` renders **multi-signal stepped line charts** (Chart.js) for one CAN message group—one mini canvas per signal with playhead support, live `appendPoint`, and phantom point extension during playback.

**Business value:** Core visualization for sniffer Charts tab—live WebSocket streaming and historical Influx replay.

---

## Architectural Process Orchestration

```
Sniffer builds ChartDataset[] per message group
        ▼
@for → app-signal-chart [datasets] [playheadTime]
        ▼
ngAfterViewInit → initAllCharts (one Chart per signal)
        ▼
Live: sniffer RAF → appendPoint / flushUpdate
Replay: extendToTime / tickPlayhead
Historical: datasets from telemetry slice
```

---

## Key Controller/Service Capabilities

| API | Purpose |
|-----|---------|
| `@Input datasets` | Signal lines + points |
| `@Input playheadTime` | Vertical playhead refresh |
| `appendPoint()` | Live stream point push |
| `flushUpdate()` | Batch chart refresh |
| `extendToTime()` | Hold last value to playhead |
| `clear()` | Reset on replay stop |
| `ChartDataset` | Exported type |

Stepped line charts; y-axis shows decoded labels from `allLabels` map.

---

## Critical Design Considerations

- **Multiple Chart instances** per component (`@ViewChildren` canvases).
- **Re-init** when dataset count changes.
- Chart.js registered at module level.

---

## Gotchas & Best Practices

- Mixed Tailwind classes in template on dark sniffer background.
- `chartHeight` input legacy—uses mini heights instead.
- Destroy charts in `ngOnDestroy`.

---

## Architectural Advice & Refactoring

**Add:** Shared chart theme service. **Remove:** CDN comments (already bundled).

---

## Navigation Strategy

Next: `sniffer.component.ts` chart RAF loop, `replay-bar.component_explanation.md`.
