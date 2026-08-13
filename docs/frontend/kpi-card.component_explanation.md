# `kpi-card.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/dashboard/kpi-card/kpi-card.component.ts`

---

## Executive Summary

`KpiCardComponent` is a **reusable dashboard metric tile**: label, large value, optional subtitle, and optional “live” styling (pulsing green border + blinking dot). It formats numeric values with `DecimalPipe` and accepts string or number for `value`.

**Business value:** Consistent KPI row on `/admin` dashboard—surfaces session count, frame totals, integrity faults, and fleet size from `DashboardStats` without duplicating card markup four times.

**Note:** Inline template and styles; pure presentation component (no services).

---

## Architectural Process Orchestration

```
DashboardStore.loadStats() → GET /api/dashboard/stats
        ▼
DashboardComponent @if (store.stats(); as stats)
        ▼
Four <app-kpi-card> instances with mapped fields:
  Sessions / Total Frames / Integrity Faults / Vehicles
        ▼
Optional isLive from stats.activeSessions or LiveTelemetryService.connected()
        ▼
KpiCardComponent renders styled card (no further data fetch)
```

No direct HTTP in this component.

---

## Key Controller/Service Capabilities

| Input | Type | Purpose |
|-------|------|---------|
| `label` | `string` (required) | Uppercase-style metric name |
| `value` | `string \| number` (required) | Main figure |
| `sub` | `string` | Optional caption under value |
| `isLive` | `boolean` | Adds `.live` pulse + green dot |

| Helper | Behavior |
|--------|----------|
| `isNumber()` | Uses `DecimalPipe` when value is number |
| Template | `@if (sub())` hides subtitle when empty |

**Dashboard bindings (parent):**

| Card | value | sub | isLive |
|------|-------|-----|--------|
| Sessions | `sessionCount` | `{activeSessions} live` | `activeSessions > 0` |
| Total Frames | `totalFrames` | static copy | `liveTelemetry.connected()` |
| Integrity Faults | `totalFaults` | static copy | `false` |
| Vehicles | `totalCars` | static copy | `false` |

---

## Critical Design Considerations

- **Signal inputs** (`input.required`) — Angular 19+ pattern; OnPush safe.
- **Live semantics differ per card** — sessions use DB active count; frames use WebSocket connection (not frame rate).
- **KPIT theme** — `#b0ff44` accent, dark `#0d1117` card background.
- **Animations** — CSS `kpi-pulse` on border, `dot-blink` on live indicator.

---

## Gotchas & Best Practices

- **`isLive` on Total Frames** reflects WS connected, not “live updating KPI value”—stats still poll every 30s.
- String `value` skips number formatting—parent always passes numbers today.
- `sub` for Sessions concatenates number + `' live'` in template string—works but not i18n-friendly.
- Component not used outside dashboard—could live under `shared/components` if reused elsewhere.
- No click/navigation—display only.

---

## Architectural Advice & Refactoring

**Add:** Optional `routerLink` or `@Output` click for drill-down; `trend` delta input. **Correct:** Align “live” meaning in docs/tooltips per metric. **Remove:** Nothing.

---

## Navigation Strategy

Next: `dashboard.component.ts`, `dashboard.store.ts`, `fault-donut-chart.component_explanation.md`, backend `DashboardStatsDto`.
