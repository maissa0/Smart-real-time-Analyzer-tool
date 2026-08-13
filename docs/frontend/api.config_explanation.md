# `api.config.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/config/api.config.ts`

---

## Executive Summary

`api.config.ts` is the **single hard-coded configuration point** for the Spring Boot backend origin in the Angular SPA. It exports one constant, `API_BASE_URL`, currently set to `http://localhost:8080`. Every REST call and the SockJS WebSocket gateway URL are built by concatenating paths onto this base.

**Business value:** Centralizes backend connectivity so developers know where to change the API host when moving from local dev to staging/production—*in theory*. In practice, the value is only realized if **all** HTTP/WebSocket clients import this constant (most do, but patterns vary).

---

## Architectural Process Orchestration

```
api.config.ts
    export const API_BASE_URL = 'http://localhost:8080'
            │
            ├─► core/services/auth.service.ts      → /api/auth/*
            ├─► core/services/can.service.ts       → /api/can/*, /api/logs/*, /api/playback/*
            ├─► core/services/user.service.ts      → /api/v1/users/*
            ├─► core/services/profile.service.ts   → /api/v1/profile/me
            ├─► core/services/audit.service.ts     → /api/v1/audit-logs
            ├─► core/services/live-telemetry.service.ts → SockJS `${API_BASE_URL}/ws-ecu-gateway`
            │
            └─► feature components (direct HttpClient usage):
                    catalog-page, fleet-page, can-workspace, sniffer, dashboard.store, …
                            │
                            ▼
                    Spring Boot :8080 (Java)
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
         MySQL          Kafka           InfluxDB
                            ▲
                    Python pipeline (separate process; not via this URL)
```

**Important boundary:** `API_BASE_URL` connects Angular **only to the JVM backend**. Python workers (`decoder.py`, `can_simulator.py`) are **not** addressed here—they talk to Kafka and are spawned indirectly via Spring (`SimulatorController`, upload pipeline).

**WebSocket path:** Must match `spring.websocket.path=/ws-ecu-gateway` in `backend/src/main/resources/application.properties`.

---

## Key Controller/Service Capabilities

| Export | Type | Responsibility |
|--------|------|----------------|
| `API_BASE_URL` | `string` constant | Origin for all backend HTTP + SockJS URLs |

**Full source (entire file):**

```typescript
/**
 * API base URL for Spring Boot backend.
 * Local: http://localhost:8080
 * Production: Configure via environment.
 */
export const API_BASE_URL = 'http://localhost:8080';
```

There are **no functions**, environment loaders, or Angular `InjectionToken` wrappers—only the exported string.

---

## Critical Design Considerations

- **Compile-time constant:** Value is baked in at build time; changing deployment target requires rebuild or manual edit unless migrated to `environment.ts` / build-time replacement.
- **Comment vs implementation gap:** Comment says *"Production: Configure via environment"* but **no `environment.prod.ts` or file replacement** exists in this repo—the comment is aspirational.
- **Dual consumption patterns:**
  - **Preferred:** Services (`CanService`, `AuthService`) prefix `base` with `API_BASE_URL`.
  - **Direct:** Some feature components import `API_BASE_URL` and call `HttpClient` inline—duplicates URL construction logic.
- **CORS:** Browser calls cross-origin only if backend CORS allows `http://localhost:4200`—configured in Java `SecurityConfig` / `WebMvcConfig`, not here.
- **JWT attachment:** This file does **not** attach tokens; `app.config.ts` `authInterceptor` adds `Authorization` header separately using `localStorage`.

---

## Gotchas & Best Practices

| Gotcha | Detail |
|--------|--------|
| **Hard-coded localhost** | Production deploy without change → all API calls fail from non-local clients. |
| **Mixed URL builders** | Some code uses `${API_BASE_URL}/api/cars`, services use `private base = ...`—inconsistent but functionally OK if constant is single. |
| **CSV export token in query string** | `sniffer.component.ts` builds `export.csv?token=` — security smell; bypasses interceptor pattern for download links. |
| **Catalog page manual headers** | `catalog-page.component.ts` builds Bearer headers manually instead of relying solely on interceptor—duplicate auth logic. |
| **No trailing slash normalization** | All consumers append `/api/...` explicitly—consistent today; breaking if someone sets `API_BASE_URL` with trailing `/`. |
| **WebSocket vs REST same host** | Correct for dev; production may need `wss://` behind TLS—SockJS URL must switch scheme with API host. |

**Best practice:** Replace with Angular **environment files** or **runtime config JSON** loaded from `/assets/config.json` for Docker/K8s deployments.

---

## Architectural Advice & Refactoring

### What to Add

```typescript
// environment.development.ts / environment.production.ts
export const environment = {
  apiBaseUrl: 'http://localhost:8080',
  wsPath: '/ws-ecu-gateway',
};
```

- **`provideAppConfig()`** factory with `InjectionToken<AppConfig>` so tests can override base URL.
- **Build script** (`ng build --configuration=production`) with `fileReplacements`.
- Document required alignment with backend `server.port=8080`.

### What to Correct

- Move **all** direct `HttpClient` + `API_BASE_URL` usage in feature components into **core services** (fleet, catalog, workspace) for one URL policy.
- Implement the production config promised in the file comment.

### What to Get Rid Of

- Scattered duplicate `authHeaders()` helpers in components when global interceptor already attaches JWT—except cases needing explicit token (CSV export).

---

## Consumer Inventory (architectural map)

| Consumer | Endpoints / usage |
|----------|-------------------|
| `auth.service.ts` | `/api/auth/*` |
| `can.service.ts` | `/api/can/*`, `/api/logs/*`, `/api/playback/*` |
| `user.service.ts` | `/api/v1/users` |
| `profile.service.ts` | `/api/v1/profile/me`, `/api/v1/sessions/{id}` |
| `audit.service.ts` | `/api/v1/audit-logs` |
| `live-telemetry.service.ts` | WebSocket ` /ws-ecu-gateway` |
| `dashboard.store.ts` | `/api/dashboard/stats`, `recent-sessions` |
| `catalog-page.component.ts` | `/api/catalogs/*` |
| `fleet-page.component.ts` | `/api/cars/*` |
| `can-workspace.component.ts` | sessions, frames, cars |
| `sniffer.component.ts` | cars, sessions, CSV export |
| `simulator-control.component.ts` | `/api/simulator/*`, `/api/cars` |
| `live-pipeline.component.ts` | `pipeline-stats` |
| `session-list.component.ts` | sessions pagination |
| Auth feature components | register, set-password (direct POST) |

Any change to `API_BASE_URL` affects **all rows above simultaneously**.

---

## Navigation Strategy

**Next files to investigate:**

1. `app.config.ts` — HTTP interceptors paired with this base URL (JWT, errors).
2. `core/services/can.service.ts` — largest CAN REST consumer.
3. `core/services/live-telemetry.service.ts` — WebSocket URL construction.
4. `backend/src/main/resources/application.properties` — `server.port`, `spring.websocket.path` (must stay in sync).
5. Consider auditing **`Frontend_angular/src/app/core/interceptors/`** next for the full HTTP client stack.

---

## Source Reference

```1:6:Frontend_angular/src/app/core/config/api.config.ts
/**
 * API base URL for Spring Boot backend.
 * Local: http://localhost:8080
 * Production: Configure via environment.
 */
export const API_BASE_URL = 'http://localhost:8080';
```
