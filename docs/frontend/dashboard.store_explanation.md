# `dashboard.store.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/dashboard/dashboard.store.ts`

---

## Executive Summary

`DashboardStore` is an **NgRx Signal Store** (`providedIn: 'root'`) that loads and holds **admin dashboard aggregates**: KPI stats and recent CAN sessions. It exposes `loadStats()` which fires two parallel HTTP GETs with manual Bearer headers from `localStorage`.

**Business value:** Central state for `/admin` home—decouples data fetching from presentation (`DashboardComponent` and chart children).

---

## Architectural Process Orchestration

```
DashboardComponent ngOnInit + interval(30s)
        ▼
DashboardStore.loadStats()
        ├─ GET /api/dashboard/stats          → stats signal
        └─ GET /api/dashboard/recent-sessions?size=5 → recentSessions signal
        ▼
Backend DashboardController (stats cached 30s server-side)
        ▼
MySQL aggregates: sessions, frames, faults, top msg IDs, cars
        ▼
patchState → DashboardComponent template + child charts
```

Does not use `CanService.getDashboardStats()`—duplicate HTTP path in store.

---

## Key Controller/Service Capabilities

| State | Type | Source |
|-------|------|--------|
| `stats` | `DashboardStats \| null` | `/api/dashboard/stats` |
| `recentSessions` | `RecentSession[]` | `/api/dashboard/recent-sessions` |
| `isLoading` | `boolean` | Set true at start of `loadStats` |
| `error` | `string \| null` | Set on stats failure only |

| Method | Behavior |
|--------|----------|
| `loadStats()` | Parallel subscribe; stats error sets user message; recent-sessions error logs only |

**Exported types:** `DashboardStats`, `RecentSession` (local to feature—not in `data/models`).

---

## Critical Design Considerations

- **Signal store pattern** — `withState` + `withMethods`; no computed selectors.
- **Dual HTTP in one method** — independent success/failure; `isLoading` cleared only on stats response.
- **Manual auth headers** — mirrors `authInterceptor` but duplicated.
- **Root-provided store** — survives route navigation; stale data until next poll.

---

## Gotchas & Best Practices

- **Recent sessions failure silent** — no `error` state; list stays empty/old.
- **Race on fast refresh** — overlapping `loadStats()` calls possible; last write wins.
- **`RecentSession` vs `CanSessionResponse`** — backend returns `CanSessionResponse`; fields mostly align.
- **`CanService.getDashboardStats`** exists but unused—consolidation opportunity.
- Backend stats **`@Cacheable("dashboard-stats")`** + frontend 30s poll align intentionally.

---

## Architectural Advice & Refactoring

**Add:** `forkJoin` or single backend endpoint; use `authInterceptor` only; loading flag per request; move types to `data/models`. **Correct:** Set error if recent-sessions fails when stats OK. **Remove:** Duplicate token header helper.

---

## Navigation Strategy

Next: `dashboard.component_explanation.md`, backend `DashboardController.java`, `CanService`, child chart docs.
