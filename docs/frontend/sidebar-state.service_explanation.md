# `sidebar-state.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/sidebar-state.service.ts`

---

## Executive Summary

`SidebarStateService` exposes a single **mobile sidebar open/closed signal** with `toggle`, `open`, and `close` methods. The admin layout and hamburger menu use it to coordinate drawer visibility on small viewports.

**Business value:** Shared UI state for responsive navigation without coupling sidebar HTML to layout parent components.

---

## Architectural Process Orchestration

```
Hamburger button (sidebar / header)
        ▼
SidebarStateService.toggle()
        ▼
isOpen signal
        ▼
Admin layout / sidebar CSS classes (open overlay, transform)
```

Pure frontend; no API.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `isOpen` | Readonly boolean signal |
| `toggle()` | Flip open state |
| `open()` / `close()` | Explicit set |

---

## Critical Design Considerations

- **Mobile-first concern** — desktop sidebar may ignore `isOpen`.
- **Root injectable** — one global drawer state.

---

## Gotchas & Best Practices

- Close sidebar on **route NavigationEnd** for better mobile UX (not always implemented).
- Backdrop click should call `close()`.

---

## Architectural Advice & Refactoring

**Add:** `effect` or router listener to auto-close on navigate. **Correct:** Nothing critical. **Remove:** Nothing.

---

## Navigation Strategy

Next: `shared/layout/sidebar/sidebar.component.html`, `layouts/admin-layout/`.
