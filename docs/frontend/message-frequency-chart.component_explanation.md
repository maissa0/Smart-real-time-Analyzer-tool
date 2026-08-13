# `message-frequency-chart.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/dashboard/message-frequency-chart/message-frequency-chart.component.ts`

---

## Executive Summary

`MessageFrequencyChartComponent` is a **standalone Chart.js bar chart** showing the **top CAN message IDs by frame count**. It accepts `{ msgId, count }[]` via signal `input`, renders KPIT-green bars with monospace x-axis labels, and updates in place when dashboard stats refresh.

**Business value:** “Top Message IDs” panel on `/admin` dashboard—helps operators see which IDs dominate traffic across stored frames (aggregated from MySQL via `CanFrameRepository.findTopMsgIds`).

**Note:** Inline template and styles; exports `MsgFrequency` interface.

---

## Architectural Process Orchestration

```
DashboardStore.loadStats() (init + every 30s)
        ▼
GET /api/dashboard/stats → topMessageIds: { msgId, count }[]  (top 5, backend)
        ▼
DashboardComponent @if (stats.topMessageIds.length > 0)
        ▼
<app-message-frequency-chart [data]="stats.topMessageIds" />
        ▼
ngAfterViewInit → initChart() (bar, 250px height)
        ▼
effect() on data() → chart.update('none') on poll refresh
```

Parent shows **“No frames yet”** when array empty—this component is not mounted.

No HTTP in this component.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `data` | Signal input `MsgFrequency[]` |
| `initChart()` | Bar chart: labels = msgId, values = count |
| `effect()` | Sync labels/data when input changes |
| `ngOnDestroy` | Destroy Chart instance |

**Chart.js:** `BarController`, `BarElement`, `CategoryScale`, `LinearScale`, `Tooltip`.

**Visual spec:** `#b0ff44` at 70% opacity bars; full green on hover; no legend; y-axis abbreviates ≥1000 as `Nk`.

---

## Critical Design Considerations

- **Presentation-only** — dumb chart child of dashboard.
- **Animation disabled** — suits 30s auto-refresh without flicker.
- **Fixed height** — 250px wrapper; responsive width.
- **Backend cap** — top **5** message IDs (not configurable from frontend).
- **Always canvas in template** — unlike fault donut, no `@if` empty state inside component (parent handles empty).

---

## Gotchas & Best Practices

- **Component destroyed/recreated** when `topMessageIds` goes 0↔N—parent `@if` toggles; chart re-inits on remount.
- **effect** skips update when `items.length === 0` but chart may still exist with stale bars if data cleared without unmounting (parent prevents mount when empty).
- X-axis labels can overlap if long hex IDs—monospace 11px only mitigation.
- Y-axis grid uses light `#f3f4f6` on dark dashboard card—may look low-contrast (dashboard wraps chart in `#0d1117` card).
- `MsgFrequency` duplicates shape of `DashboardStats.topMessageIds`—not shared type import.

---

## Architectural Advice & Refactoring

**Add:** Shared type in `dashboard.store.ts` or `data/models`; configurable top-N; dark-theme axis colors. **Correct:** Extract shared Chart.js theme with `fault-donut-chart` and sniffer charts. **Remove:** Duplicate Chart.register if centralized.

---

## Navigation Strategy

Next: `dashboard.component.ts`, `dashboard.store.ts`, `kpi-card.component_explanation.md`, backend `DashboardController`, `CanFrameRepository.findTopMsgIds`.
