# `signal-chart/index.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/signal-chart/index.ts`

---

## Executive Summary

Barrel file re-exporting **`SignalChartComponent`** and **`ChartDataset`** type from `signal-chart.component.ts`.

**Business value:** Clean import path for consumers (`from './signal-chart'`).

---

## Architectural Process Orchestration

```
signal-chart.component.ts
        ▼
index.ts re-exports
        ▼
sniffer.component.ts imports SignalChartComponent
```

---

## Key Controller/Service Capabilities

| Export | Kind |
|--------|------|
| `SignalChartComponent` | Component class |
| `ChartDataset` | Type alias |

---

## Critical Design Considerations

- Type-only + component export; no runtime logic.

---

## Gotchas & Best Practices

- Sniffer imports component directly from path in some places—barrel optional.

---

## Architectural Advice & Refactoring

**Add:** Export from feature-level `sniffer/index.ts` if created. **Remove:** Nothing.

---

## Navigation Strategy

Next: `signal-chart.component_explanation.md`.
