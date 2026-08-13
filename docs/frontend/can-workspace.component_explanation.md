# `can-workspace.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/analyser/can-workspace.component.ts`

---

## Executive Summary

`CanWorkspaceComponent` is the **full-screen CAN analysis shell** at `/admin/workspace`. It wraps `SnifferComponent` with a collapsible left sidebar for vehicle/session selection, log upload, simulator controls, and **cascading frame filters** (message ID, bus, faults, message/signal checklists). It orchestrates fleet-scoped session lists and passes filter state into the sniffer via `@Input()` bindings.

**Business value:** Single “analyst desk” UX—pick a vehicle, open or create a session, filter traffic, and analyze in the embedded sniffer without duplicating sniffer internals in a new feature.

---

## Architectural Process Orchestration

```
Route /admin/workspace (authGuard)
        ▼
CanWorkspaceComponent
        ├─ loadCars()     → GET /api/cars
        ├─ loadSessions() → GET /api/can/sessions | /api/cars/{uid}/sessions
        ├─ wsLoadFrames() → GET /api/can/sessions/{id}/frames  (filter metadata only)
        └─ LiveTelemetryService.connected (read-only WS status dot)
        ▼
Left panel: LogUploadComponent / SimulatorControlComponent
        ▼
Right panel: <app-sniffer [hideUpload] [hideSimulator] [autoSelectSessionId] [external*]>
        ▼
SnifferComponent → CanService, TelemetryService, LiveTelemetryService, ReplayEngineService
        ▼
Backend MySQL + Kafka/WebSocket pipeline
```

**Upload path:** `LogUploadComponent` → backend log ingest → `onUploadComplete(sessionId)` refreshes list and auto-opens session.

**Simulator path:** `SimulatorControlComponent` → Python sim via backend → polling finds `sourceFilename === 'live_simulation'`.

---

## Key Controller/Service Capabilities

| Area | Responsibility |
|------|----------------|
| **Fleet filter** | Vehicle `<select>` → `selectedVehicleUid`, scoped session list |
| **Session list** | Click row → `openSession(id)`, URL `?sessionId=`, reset filters |
| **New session** | Toggle upload/sim panels; delegate to child components |
| **Filter panel** | `filterMsgId`, `filterBus`, `faultsOnly`, `anomalyOnly`, `visibleMessages`, `visibleSignalNames` |
| **Computed options** | `availableMsgIds`, `availableBuses`, `availableMessages`, `availableSignalNames` from `wsFrames` |
| **Sniffer embed** | `[hideUpload]="true"`, `[hideSimulator]="true"`, external filter inputs |
| **Auth headers** | Private `h()` reads `localStorage.access_token` (parallel to `authInterceptor`) |

Local interfaces `Car` and `Session` (lines 16–24) are **inline DTOs**, not `data/models/can.model.ts`.

---

## Critical Design Considerations

- **Composition over duplication** — workspace owns chrome + filters; sniffer owns charts, playback, integrity UI.
- **Dual frame fetch** — workspace loads frames for filter dropdowns; sniffer **loads frames again** for display (`sessionLoading` is a 2s timeout, not tied to sniffer readiness).
- **Filter semantics** — empty `Set` for visible messages/signals means “show all” (`wsIsMessageVisible` / `wsIsSignalVisible`).
- **Cascading filters** — changing msg ID clears bus + checklist selections.
- **Standalone component** — inline template (~285 lines) + inline styles (~265 lines); imports `HttpClientModule` directly.
- **Zoneless** — `ChangeDetectionStrategy.OnPush` + signals/computed.

---

## Gotchas & Best Practices

- **Bypasses `CanService`** — uses raw `HttpClient` + manual Bearer header; drift risk vs interceptor-only auth.
- **`sessionLoading`** — fixed `setTimeout(..., 2000)` may hide sniffer too early or too late.
- **`openSession` toggle** — clicking active session sets `toggled = null` but still navigates with `sessionId: id` in query params (may not clear URL).
- **Simulator interval** — stored as `(this as any)._simInterval`; must clear on destroy (currently **no `ngOnDestroy`** — leak if user navigates away while sim running).
- **`wsPassFiltersToSniffer()`** — empty stub; filters rely entirely on template bindings.
- **Naming collision** — local `Session` ≠ IAM `Session` in `audit-log.model.ts`.
- **WS “Live” indicator** — reflects `LiveTelemetryService.connected`; connection likely established by child sniffer, not workspace.

---

## Architectural Advice & Refactoring

**Add:** `ngOnDestroy` to clear `_simInterval`; use `CanService` instead of duplicate HTTP; drive `sessionLoading` from sniffer `@Output() ready`. **Correct:** Clear `sessionId` query param when deselecting session; align `Session` type with `CanSession`. **Remove:** Arbitrary upload/sim `setTimeout` chains—replace with API callbacks or WebSocket session events.

---

## Navigation Strategy

Next: `sniffer.component.ts`, `log-upload.component.ts`, `simulator-control.component.ts`, `can.service_explanation.md`, route entry in `app.routes.ts` (`/admin/workspace`).
