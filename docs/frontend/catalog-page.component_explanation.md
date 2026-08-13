# `catalog-page.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/catalogs/catalog-page.component.ts`

---

## Executive Summary

`CatalogPageComponent` is the **ECU XML catalog management UI** at `/admin/catalogs`. It lists DBC-like XML catalog files from the backend filesystem, lets operators upload/delete/reload catalogs, and browses message/signal definitions in an expandable tree on the right panel.

**Business value:** Admin-facing control over signal decoding metadata used by the Python parser and Java `CatalogLoaderService`—feeds integrity analysis and frame label resolution in the sniffer pipeline.

**Note:** Single file with **inline template and styles** (~350 lines each); local TypeScript interfaces (not `data/models/`).

---

## Architectural Process Orchestration

```
Route /admin/catalogs (authGuard on /admin)
        ▼
CatalogPageComponent
        ├─ GET  /api/catalogs              → list summaries
        ├─ GET  /api/catalogs/{filename} → message/signal detail
        ├─ POST /api/catalogs/upload       → multipart XML
        ├─ DELETE /api/catalogs/{filename}
        └─ POST /api/catalogs/reload       → refresh CatalogLoaderService
        ▼
CatalogController (Java) → catalog.path XML dir + EcuCatalogRepository sync
        ▼
CatalogLoaderService.load() → in-memory signal/cycle maps
        ▼
Python pipeline / CAN decoder reads same catalogues dir (config-aligned)
```

Manual `Authorization: Bearer` via `localStorage.access_token` (parallel to `authInterceptor`).

---

## Key Controller/Service Capabilities

| UI area | Method / signal | Backend |
|---------|-----------------|---------|
| Left list | `loadCatalogs()`, `catalogs`, `loadingList` | `GET /api/catalogs` |
| Select card | `selectCatalog(filename)` | `GET /api/catalogs/{filename}` |
| Upload | `onFileSelected` (.xml only) | `POST /api/catalogs/upload` |
| Delete | `deleteCatalog` + confirm | `DELETE /api/catalogs/{filename}` |
| Reload | `reloadCatalogs()` | `POST /api/catalogs/reload` |
| Detail tree | `toggleMessage`, `isMessageOpen`, `totalSignals` | Client-only |
| Status toast | `showStatus` (4s auto-clear) | Inline success/error |

**Local types:** `CatalogSummary`, `CatalogDetail`, `MessageDef`, `SignalDef`, `SignalValue`.

---

## Critical Design Considerations

- **No dedicated `CatalogService`** — all HTTP inline in component (like early `can-workspace` pattern).
- **Master-detail layout** — left catalog cards, right message accordion.
- **Auto-expand messages** — on detail load, all message IDs added to `openMessages` Set.
- **Re-render hack** — `toggleMessage` clones `detail` signal to trigger OnPush update for Set mutation.
- **XML typo in backend** — parses tag `massage` (not `message`)—frontend types assume backend JSON shape.

---

## Gotchas & Best Practices

- **401 if unauthenticated** — `/api/catalogs/*` not in `PUBLIC_PATHS`; page requires valid JWT (sidebar under `/admin`).
- **Upload Content-Type** — must not set JSON header on `FormData` (component only adds Bearer—correct).
- **Error handling minimal** — list/detail errors silently clear loading flags; no toast for GET failures.
- **`openMessages` is not a signal** — expand/collapse relies on detail clone trick.
- Catalog files live at `catalog.path` (`python_parser/catalogues`)—must match Python `pipeline.catalogues.dir`.
- No shared models—DTO drift risk if backend map keys change.

---

## Architectural Advice & Refactoring

**Add:** `CatalogService` in `core/services/`; move interfaces to `data/models/catalog.model.ts`; use `errorInterceptor` messages for GET failures. **Correct:** Signal `openMessages` or use `signal<Set<string>>`. **Remove:** Duplicate auth header helper—rely on interceptor only.

---

## Navigation Strategy

Next: backend `CatalogController.java`, `CatalogLoaderService.java`, `python_parser/catalogues/`, sidebar link in `sidebar.component.html`, `app.routes.ts` `/admin/catalogs`.
