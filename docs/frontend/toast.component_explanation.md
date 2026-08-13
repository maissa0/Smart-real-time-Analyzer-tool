# `toast.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/components/toast/toast.component.ts`

---

## Executive Summary

`ToastComponent` is the **global toast renderer** mounted in `AppComponent`. It reads `ToastService.toasts()` and displays stacked alerts bottom-right with dismiss buttons and optional detail bullets.

**Business value:** Unified feedback for API success/error across sniffer, users, auth, settings—driven by imperative `toast.success()` / `toast.error()` calls.

---

## Architectural Process Orchestration

```
Feature / interceptor → ToastService.show()
        ▼
Signal _toasts updated (+ auto dismiss timer)
        ▼
AppComponent hosts <app-toast /> (z-index 9999)
        ▼
@for toast → styled alert; dismiss → toastService.dismiss(id)
```

Also fed by `error.interceptor` for HTTP failures.

---

## Key Controller/Service Capabilities

| Member | Role |
|--------|------|
| `toastService` | Injected readonly |
| `typeClasses(type)` | Maps success/error/warning/info → Tailwind colors |
| Template | Fixed bottom-right stack, `role="alert"` |

Types from `ToastService`: `ToastType`, optional `details[]`.

---

## Critical Design Considerations

- **Root-level singleton UI** — one instance for entire app.
- **OnPush** — updates when service signal changes.
- **Light pastel styling** — green/red/amber/blue panels (visible on dark pages).

---

## Gotchas & Best Practices

- Must stay in `AppComponent`—features only inject service, not component.
- No queue limit—rapid toasts stack vertically.
- `toast.show()` legacy signature still used in some sniffer code vs `success`/`error` helpers.

---

## Architectural Advice & Refactoring

**Add:** Max visible count, dark-theme variant. **Consolidate:** All features on `ToastService` helpers. **Test:** z-index vs modals (modals z-50, toast z-9999).

---

## Navigation Strategy

Next: `toast.service_explanation.md`, `app.component.ts`, `error.interceptor_explanation.md`.
