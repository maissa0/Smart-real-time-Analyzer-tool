# `toast.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/toast.service.ts`

---

## Executive Summary

`ToastService` maintains a **FIFO queue of transient toast notifications** (success, error, info, warning) with auto-dismiss timers. It is invoked globally by `error.interceptor.ts` on HTTP failures and can be used explicitly from features for user feedback.

**Business value:** Consistent, non-blocking error/success UX across the admin app without each component implementing its own alert logic.

---

## Architectural Process Orchestration

```
HTTP error → errorInterceptor
        ▼
ToastService.error(message)
        ▼
_toasts signal updated
        ▼
ToastComponent (layout) renders queue
        ▼
setTimeout auto-remove after duration
```

No backend involvement.

---

## Key Controller/Service Capabilities

| Method | Responsibility |
|--------|----------------|
| `toasts` | Readonly signal of toast objects `{ id, message, type, duration? }` |
| `success` / `error` / `info` / `warning` | Enqueue typed toast |
| `remove(id)` | Dismiss one |
| `clear()` | Empty queue |

Internal `add()` assigns UUID and schedules removal.

---

## Critical Design Considerations

- **Global side effect** — interceptor depends on this service; avoid circular DI.
- **Signal queue** — immutable array updates for zoneless templates.

---

## Gotchas & Best Practices

- **Duplicate toasts** on rapid 401s — consider debounce for auth errors.
- Long messages from backend `ApiError` may overflow UI—truncate in interceptor if needed.
- Default duration should be consistent per type.

---

## Architectural Advice & Refactoring

**Add:** Dedup key for identical consecutive errors. **Correct:** Ensure ToastComponent is in root layout. **Remove:** Nothing.

---

## Navigation Strategy

Next: `core/interceptors/error.interceptor.ts`, toast UI component in shared/layout.
