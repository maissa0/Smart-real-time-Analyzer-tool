# `sniffer.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/sniffer.component.html`

---

## Executive Summary

The sniffer template defines the **main content pane only** (not the session sidebar): empty state, session header, live pipeline, replay bar, and three tab bodies (table, charts, integrity). Child components handle specialized UI; parent binds signals and event handlers.

**Business value:** Declarative layout for the inspection workspace once a session is selected.

---

## Architectural Process Orchestration

```
@if !selectedSession → kpit-no-session placeholder
@if selectedSession
  ├─ kpit-session-header (filename, LIVE badge, frame count, dates, tabs)
  ├─ @if isLiveSession → app-live-pipeline
  ├─ @if completed live_simulation → “Session complete” banner
  ├─ @if !isLiveSession (replay eligible) → app-replay-bar
  ├─ activeTab === 'table' → app-frame-table + action bar (CSV, charts, AI)
  ├─ activeTab === 'charts' → toolbar + @for app-signal-chart (live vs historical groups)
  └─ activeTab === 'integrity' → summary stats + fault list
```

Tab buttons call `setTab('table'|'charts'|'integrity')`.

---

## Key Controller/Service Capabilities

| Region | Bindings |
|--------|----------|
| Header | `selectedSession()`, `isLiveSession()`, `liveTelemetry.connected()`, `filteredVisibleFrames()`, `durationSeconds()`, `recordingDate()` |
| Replay | `(playRequested)`, `(stopRequested)`, `(seekRequested)` → component methods |
| Table | `[frames]="filteredVisibleFrames()"`, `[faultsByFrameId]`, `[visibleSignalNames]` |
| Charts | `liveSignalGroups()` vs `signalTimelines()`, `playheadRelativeTime()`, `chartMode()` stacked/combined |
| Integrity | `integritySummary()`, `integrityFaults()`, `loadingIntegrity()` |
| Actions | `csvExportUrl()`, `navigateToAi()`, `setTab('charts')` |

Uses Angular 17+ `@if` / `@for` control flow.

---

## Critical Design Considerations

- **No session list in template** — selection comes from parent (`CanWorkspace`) or programmatic `selectSession` / URL param.
- **Conditional replay bar** — hidden for in-progress live sim; shown for uploads and completed live sessions.
- **Inline styles** on some date badges (not SCSS classes).

---

## Gotchas & Best Practices

- Standalone route `/admin/sniffer` shows “Select a session” until `?sessionId=` or external parent selects one.
- Chart grid class `kpit-charts-combined` toggled by `chartMode`.
- `chartJsLoaded()` gate shows loading placeholder before Chart.js init.

---

## Architectural Advice & Refactoring

**Add:** Optional `<ng-content>` or `@Input showSidebar` wrapper for full-page sniffer. **Move:** Inline badge styles to SCSS.

---

## Navigation Strategy

Next: `sniffer.component.scss`, child component docs (`frame-table`, `replay-bar`, `live-pipeline`, `signal-chart`).
