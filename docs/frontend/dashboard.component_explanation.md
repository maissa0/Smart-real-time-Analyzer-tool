# `dashboard.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/dashboard/dashboard.component.ts`

---

## Executive Summary

`DashboardComponent` is the **default admin home** at `/admin` (empty child route). It composes KPI cards, message frequency bar chart, fault donut chart, and a recent-sessions list; polls `DashboardStore.loadStats()` every 30 seconds; and shows WebSocket connection status from `LiveTelemetryService` without initiating the connection itself.

**Business value:** Operational overview of CAN platform health—sessions, frames, integrity faults, fleet size, and quick navigation to workspace/sniffer.

**Note:** Large **inline template** (~120 lines) with inline styles; no separate HTML file.

---

## Architectural Process Orchestration

```
Route /admin (authGuard) → default child DashboardComponent
        ▼
ngOnInit: store.loadStats() + interval(30_000)
        ▼
DashboardStore → /api/dashboard/stats + recent-sessions
        ▼
Template sections:
  ├─ Header (WS status from liveTelemetry.connected())
  ├─ 4× app-kpi-card
  ├─ app-message-frequency-chart + app-fault-donut-chart
  └─ Recent sessions → click → /admin/sniffer?sessionId=
        ▼
"View All" → /admin/workspace
```

WebSocket indicator reflects **`LiveTelemetryService.connected`**—typically true only if another feature (e.g. sniffer) already connected.

---

## Key Controller/Service Capabilities

| Area | Implementation |
|------|----------------|
| **Loading** | `store.isLoading() && !store.stats()` spinner |
| **Error** | `store.error()` banner |
| **KPI row** | Sessions, frames, faults, vehicles — see `kpi-card` docs |
| **Charts** | `topMessageIds` → bar chart; `faultsByType` → `toFaultEntries()` → donut |
| **Sessions list** | `store.recentSessions()`; `formatDate` (fr-FR time) |
| **Navigation** | `openSession`, `goTo` |

**Child components:** `KpiCardComponent`, `MessageFrequencyChartComponent`, `FaultDonutChartComponent`.

**Imports `HttpClientModule`** — unused by component directly (store uses injected HttpClient); harmless redundancy.

---

## Critical Design Considerations

- **OnPush + store signals** — template reads `store.stats()`, `store.recentSessions()` directly (public store injection).
- **Polling only** — no WebSocket push for dashboard metrics.
- **Inline hover handlers** — `onmouseover`/`onmouseout` on session rows (imperative DOM style).
- **Fault chart always mounted** — empty faults handled inside `FaultDonutChartComponent`.
- **Message chart conditional** — `@if (stats.topMessageIds.length > 0)`.

---

## Gotchas & Best Practices

- **WS “Disconnected” on dashboard-only visit** — expected unless `LiveTelemetryService.connect()` called elsewhere; “Total Frames” live pulse may mislead.
- **`toFaultEntries`** — `Object.entries` order depends on backend `LinkedHashMap` ordering.
- **Sniffer vs workspace** — recent session opens **sniffer**; “View All” goes to **workspace** (different UX).
- No `LiveTelemetryService.connect()` in `ngOnInit`—unlike sniffer.
- Responsive layout uses fixed 4-column KPI grid—may overflow on narrow viewports.

---

## Architectural Advice & Refactoring

**Add:** Call `liveTelemetry.connect()` if WS status should be meaningful here; extract template to HTML/SCSS; use `CanService` via store refactor. **Correct:** Angular `(mouseenter)` instead of inline HTML handlers. **Remove:** Unused `HttpClientModule` import if store-only HTTP.

---

## Navigation Strategy

Next: `dashboard.store_explanation.md`, `kpi-card`, `message-frequency-chart`, `fault-donut-chart` docs, `app.routes.ts` `/admin` default route.
