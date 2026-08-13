# `app.config.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/app.config.ts`

---

## Executive Summary

`app.config.ts` is the **Angular application bootstrap configuration**: zoneless change detection, router, HTTP client with **auth** and **error** interceptors. It wires the frontend to the Spring Boot API via Bearer JWT attachment on non-public paths.

**Business value:** Central DI/bootstrap layer—every feature HTTP call flows through providers defined here.

---

## Architectural Process Orchestration

```
main.ts → bootstrapApplication(AppComponent, appConfig)
        ▼
provideZonelessChangeDetection()
provideRouter(appRoutes)
provideHttpClient(withInterceptors([authInterceptor, errorInterceptor]))
        ▼
Outbound HTTP request
        ├─ authInterceptor: localStorage access_token → Authorization header
        └─ errorInterceptor: HttpErrorResponse → ToastService
        ▼
Spring Boot REST (:8080 via api.config / proxy)
```

---

## Key Controller/Service Capabilities

| Provider | Role |
|----------|------|
| `provideZonelessChangeDetection()` | Signals/async-driven UI without Zone.js |
| `provideRouter(appRoutes)` | Top-level routing |
| `authInterceptor` | Inline `HttpInterceptorFn`—skips `PUBLIC_AUTH_PATHS`, else Bearer token |
| `errorInterceptor` | Imported from `core/interceptors/error.interceptor.ts` |

**Public paths (no Bearer):** login, register, refresh, forgot-password, verify-otp, reset-password, set-password, mfa/verify, avatar uploads.

---

## Critical Design Considerations

- **`authInterceptor` defined inline** — not a separate file; duplicates token source with `AuthStore` (reads `localStorage` directly).
- **Interceptor order** — auth runs before error handler on outbound; errors caught on response path.
- **No STOMP/WebSocket providers** — live CAN uses separate client setup in services.
- **No global store providers** — `AuthStore` / `UserStore` use `providedIn: 'root'`.

---

## Gotchas & Best Practices

| Risk | Detail |
|------|--------|
| **Token desync** | `AuthStore.setAccessToken()` does not update `localStorage`; interceptor only reads localStorage. |
| **Public path matching** | Uses `url.includes(p)`—fragile if API base URL embeds substring accidentally. |
| **401 handling** | Error interceptor toasts but does not auto-logout or redirect. |
| **No retry refresh** | No automatic token refresh interceptor on 401. |

**Best practice:** Move `authInterceptor` to `core/interceptors/` and inject `AuthStore` or sync localStorage on every token change.

---

## Architectural Advice & Refactoring

**Add:** `withFetch()` if migrating to fetch backend; refresh-token interceptor; `provideAnimationsAsync` if needed. **Extract:** `authInterceptor` to dedicated file with tests. **Unify:** Single token source with `AuthStore`.

---

## Navigation Strategy

Next: `error.interceptor_explanation.md`, `auth.store_explanation.md`, `main.ts`, `core/config/api.config_explanation.md`.
