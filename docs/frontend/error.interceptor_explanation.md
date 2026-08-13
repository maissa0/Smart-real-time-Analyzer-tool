# `error.interceptor.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/interceptors/error.interceptor.ts`

---

## Executive Summary

`errorInterceptor` is a **global HTTP error handler** for the Angular SPA. It sits in the `HttpClient` pipeline after outgoing requests complete (or fail), maps backend error payloads to user-visible **toast notifications**, and **re-throws** the error so callers can still handle failures locally if needed.

**Business value:** Gives operators consistent feedback when Spring Boot returns 401/403/422/429/5xx or when the network fails—without every feature component duplicating error-to-toast logic.

---

## Architectural Process Orchestration

```
Feature / Service (HttpClient.get/post/…)
        │
        ▼
app.config.ts  provideHttpClient(withInterceptors([
        authInterceptor,      ← defined inline in app.config.ts (NOT this folder)
        errorInterceptor,     ← this file (runs second)
]))
        │
        ▼
HTTP request → Spring Boot :8080 (API_BASE_URL)
        │
        ├─ success → response passes through unchanged
        │
        └─ failure → HttpErrorResponse
                │
                ▼
        errorInterceptor catchError
                ├── parse body as ApiError (Java GlobalExceptionHandler shape)
                ├── ToastService.error / .warning (UI)
                └── throwError(() => err)  → subscriber still gets error
```

**Backend contract:** Java `GlobalExceptionHandler` and `SecurityConfig` entry points emit **`ApiError`** JSON (`message`, `errors`, `status`, `path`)—documented in `data/types/api.types.ts` Section 5.1.

**Interceptor order matters:** `authInterceptor` runs **first** (adds Bearer token); `errorInterceptor` runs **second** (handles response errors). Neither touches Kafka or Python directly.

**Folder note:** This directory contains **only** the error interceptor. **`authInterceptor` lives in `app.config.ts`**—audit that file separately for the full HTTP client stack.

---

## Key Controller/Service Capabilities

| Export | Type | Responsibility |
|--------|------|----------------|
| `errorInterceptor` | `HttpInterceptorFn` | Global `catchError` on all HttpClient traffic |

**Status handling matrix:**

| HTTP status | Toast type | Message source |
|-------------|------------|----------------|
| **422** Unprocessable Entity | `error` | `body.message` + optional field `errors` flattened to details |
| **429** Too Many Requests | `error` | `body.error` or default rate-limit text |
| **≥ 500** | `error` | `body.message` or generic server error |
| **401** Unauthorized | `error` | `body.message` or "Session expired…" |
| **403** Forbidden | `error` | `body.message` or permission denial |
| **404** Not Found | `warning` | `body.message` or not-found default |
| **Other ≥ 400** | `error` | `body.message` or status code fallback |
| **`ErrorEvent` (network)** | `error` | "A network error occurred…" |
| **Else** | `error` | "An unexpected error occurred." |

**Critical behavior:** Always **`return throwError(() => err)`**—does not swallow errors; components/services with `.subscribe({ error: … })` still run.

**Dependencies:**

- `inject(ToastService)` — signal-based toast queue consumed by `ToastComponent` at app root.
- `ApiError` type from `data/types/api.types.ts`.

---

## Critical Design Considerations

- **Functional interceptor pattern:** Angular 15+ `HttpInterceptorFn` with `inject()`—no class-based `HTTP_INTERCEPTORS` token.
- **Global scope:** Registered once in `app.config.ts`; applies to **every** HttpClient call including auth login (failed login shows toast—usually desired).
- **422 field errors:** Flattens `Record<string, string[]>` into `"field: message"` detail lines for toast UI.
- **401 does not auto-logout:** Shows toast only; does **not** call `AuthStore.logout()` or redirect to login—unlike some enterprise apps.
- **404 as warning:** Softer UX for missing resources vs hard errors.

---

## Gotchas & Best Practices

| Gotcha | Detail |
|--------|--------|
| **Double error UX** | Component may also set local `errorMessage` signal **and** interceptor shows toast—duplicate messages possible. |
| **Silent failures avoided only for HTTP** | WebSocket/STOMP errors use separate handling in `LiveTelemetryService`. |
| **401 storm** | Multiple parallel 401s → multiple toasts; no debouncing. |
| **Expected 404 ignored** | e.g. `stopPlayback` intentionally ignores 404 in component—but toast may still fire unless request bypasses interceptor (it doesn't). |
| **429 body shape** | Checks `body.error` not `body.message`—must match Bucket4j/rate-limit response from backend. |
| **Login 401** | Wrong password triggers toast via this interceptor—good for UX; ensure login form doesn't duplicate. |

**Best practice:** For endpoints where errors are **expected** (polling, optional resources), handle in service with `catchError` that returns `EMPTY` **after** interceptor already fired—or use `HttpContext` token to skip global toast (not implemented today).

---

## Architectural Advice & Refactoring

### What to Add

- **`SKIP_ERROR_TOAST` HttpContext token** for calls that handle errors silently (playback stop 404, health checks).
- **401 handler:** central redirect to `/auth/login` + `AuthStore.logout()` once (with debounce).
- **Move `authInterceptor`** from `app.config.ts` into `core/interceptors/auth.interceptor.ts` for symmetry and testability.
- **Logging service** hook for non-UI error telemetry (optional).

### What to Correct

- Align 429 response parsing with backend actual JSON field names.
- Review components that duplicate toast on same error path.

### What to Get Rid Of

- Nothing in this file—it is appropriately focused. Avoid adding success toasts here (belongs in feature logic).

---

## Navigation Strategy

**Next files:**

1. `app.config.ts` — `authInterceptor` + interceptor registration order.
2. `core/services/toast.service.ts` — toast queue and UI contract.
3. `shared/components/toast/toast.component.ts` — renders messages from this interceptor.
4. `data/types/api.types.ts` — `ApiError` shape.
5. Backend `exception/GlobalExceptionHandler.java` — server-side error JSON source.

---

## Source Reference

```typescript
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const body = err.error as ApiError | { message?: string; error?: string } | null;
      // ... status-specific toast branches ...
      return throwError(() => err);
    })
  );
};
```

**Registered as:**

```typescript
provideHttpClient(withInterceptors([authInterceptor, errorInterceptor]))
```

in `app.config.ts`.
