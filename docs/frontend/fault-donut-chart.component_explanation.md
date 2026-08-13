# `fault-donut-chart.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/dashboard/fault-donut-chart/fault-donut-chart.component.ts`

---

## Executive Summary

`FaultDonutChartComponent` is a **standalone Chart.js doughnut widget** that visualizes **integrity fault counts by type** (`SIGNAL_RANGE`, `TIMING_GAP`, `DUPLICATE`, etc.). It receives `{ type, count }[]` via signal `input`, renders a donut canvas plus custom HTML legend with percentages, and shows a green empty state when no faults exist.

**Business value:** Dashboard “Fault Distribution” panel—gives operators at-a-glance breakdown of CAN integrity issues aggregated across sessions (from `DashboardStatsDto.faultsByType`).

**Note:** Inline template and styles; exports `FaultEntry` interface for parent mapping.

---

## Architectural Process Orchestration

```
DashboardComponent ngOnInit → DashboardStore.loadStats()
        ▼
GET /api/dashboard/stats → faultsByType: Record<string, number>
        ▼
toFaultEntries() → FaultEntry[]
        ▼
<app-fault-donut-chart [data]="..." />
        ▼
hasData() computed → canvas + labels OR "No faults detected"
        ▼
Chart.js doughnut (cutout 68%, no built-in legend)
        ▼
effect() on data() → chart.update('none') on changes
```

Fault types originate from **`IntegrityFaultEntity.faultType`** / analyzer pipeline—not computed in this component.

Parent: `dashboard.component.ts` only consumer.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `data` | Signal input `FaultEntry[]` |
| `hasData` | True if any entry has `count > 0` |
| `colorFor(type)` | Fixed map: SIGNAL_RANGE red, TIMING_GAP amber, DUPLICATE blue, other grey |
| `pct(count)` | Rounded percentage of total counts |
| `initChart()` | Creates Chart after 50ms timeout (canvas in `@if`) |
| `effect()` | Syncs labels/data/colors when input changes |
| `ngOnDestroy` | `chart.destroy()` |

**Chart.js:** registers `ArcElement`, `DoughnutController`, `Tooltip` (duplicate register safe per comment).

---

## Critical Design Considerations

- **Presentation-only** — no HTTP; pure visualization Dumb component.
- **Custom legend** — Chart.js legend disabled; HTML labels match jury color scheme.
- **OnPush + signal input** — zoneless-friendly; `effect` drives chart updates.
- **Init timing** — `setTimeout(50)` waits for `@if (hasData())` to mount canvas.
- **Animation off** — `animation: false` for stable dashboard refresh every 30s.

---

## Gotchas & Best Practices

- **Chart not recreated** when going empty→data after first init—`initChart` only in `ngAfterViewInit`; if dashboard loads empty then gets data, chart may not appear until navigation away/back (effect returns early if `!this.chart`).
- **`hasData()` false** when all counts are 0—even if types exist in array.
- Type strings must match backend keys (`SIGNAL_RANGE`, not `signal_range`) for colors.
- Aligns with `IntegrityFault` union in `can.model.ts` but not imported—stringly typed.
- White segment borders (`borderColor: '#ffffff'`) assume light card background in dashboard.

---

## Architectural Advice & Refactoring

**Add:** Re-init chart when `hasData()` flips true after false; move `FaultEntry` to `data/models`. **Correct:** Watch `hasData` in effect to call `initChart` when canvas appears. **Remove:** Duplicate Chart.register if centralized in chart module.

---

## Navigation Strategy

Next: `dashboard.component.ts`, `DashboardStore`, backend `DashboardController.getStats`, `IntegrityAnalyzerService`, `can.model.ts` `IntegrityFault`.
