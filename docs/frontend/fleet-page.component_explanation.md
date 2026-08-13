# `fleet-page.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/fleet/fleet-page.component.ts`

---

## Executive Summary

`FleetPageComponent` is the **vehicle fleet management screen** at `/admin/fleet`. It lists cars from the backend, supports add/edit/delete via modal, shows per-vehicle CAN sessions on row select, and navigates to the sniffer for analysis. All CRUD uses direct `HttpClient` calls to `/api/cars` with manual Bearer headers.

**Business value:** Organizes physical and virtual vehicles tied to CAN log sessions—bridge between fleet metadata (MySQL `cars`) and session analysis workflow.

**Note:** Single file with large **inline template** (~290 lines); local `Car` interface (not shared `data/models`).

---

## Architectural Process Orchestration

```
Route /admin/fleet (authGuard) — sidebar "Fleet"
        ▼
FleetPageComponent
        ├─ GET  /api/cars                    → vehicle table + stats row
        ├─ POST /api/cars                    → add vehicle (modal)
        ├─ PUT  /api/cars/{carUid}           → edit vehicle
        ├─ DELETE /api/cars/{carUid}         → delete (confirm)
        └─ GET  /api/cars/{carUid}/sessions  → sessions panel
        ▼
CarController (Java) → CarService / CanSessionService
        ▼
MySQL cars + can_sessions
        ▼
"Analyse →" → router /admin/sniffer?sessionId=
```

Also consumed indirectly: dashboard `totalCars`, workspace/sniffer car dropdowns, simulator car list.

---

## Key Controller/Service Capabilities

| UI section | Signals / methods | API |
|------------|-------------------|-----|
| Stats row | `physicalCount`, `virtualCount` computed | from `cars()` list |
| Vehicle table | `cars`, `loading` | GET `/api/cars` |
| Row click | `selectCar`, `carSessions`, `sessionsLoading` | GET `.../sessions` |
| Add/Edit modal | `showModal`, `form`, `saveVehicle` | POST / PUT |
| Delete | `deleteCar` + `confirm` | DELETE |
| Analyse | `analyseSession` | navigate only |

**Form fields:** make, model, year (required), color, vin, `isVirtual` checkbox.

**Not used:** `Car.sessionCount`, `totalFrames`, `faultRate` optional fields—no UI columns despite interface definition.

---

## Critical Design Considerations

- **Monolithic standalone component** — no child components or fleet store.
- **FormsModule + ngModel** in modal (unlike reactive forms on auth pages).
- **Shared fleet visibility** — backend returns all active cars for authenticated users (single-org deployment).
- **Session panel** — inline expandable section, not separate route.

---

## Gotchas & Best Practices

- **No `CarService` on frontend** — duplicates HTTP patterns in sniffer, workspace, simulator (no central facade).
- **Manual `authHeaders()`** — parallel to `authInterceptor`; delete errors swallowed silently.
- **`carSessions` typed `any[]`** — should use `CanSession` from `can.model.ts`.
- Inline `onmouseover`/`onmouseout` on rows/buttons — same pattern as dashboard.
- **`isActive` displayed** but not editable in modal—backend may default only.
- Row click opens sessions; Edit/Delete use `stopPropagation` on actions column.

---

## Architectural Advice & Refactoring

**Add:** `FleetService` or extend domain API layer; shared `Car` DTO; toast on delete failure; edit `isActive`. **Correct:** Use `CanSession` type; extract modal to subcomponent. **Remove:** Unused optional stats fields from interface or surface in table.

---

## Navigation Strategy

Next: backend `CarController.java`, `CarDto.java`, `can-workspace.component.ts`, `sniffer.component.ts` car filters, `dashboard` vehicles KPI.
