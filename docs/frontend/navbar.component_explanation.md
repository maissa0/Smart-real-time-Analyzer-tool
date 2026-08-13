# `navbar.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/layout/navbar/navbar.component.ts`

---

## Executive Summary

`NavbarComponent` is the **fixed top bar** for the admin shell: hamburger (sidebar toggle), brand, global search field, stub icon buttons, and profile dropdown with logout. It reads `AuthStore` for user/avatar and coordinates with `SidebarStateService`.

**Business value:** Persistent navigation chrome across all `/admin/*` routes—identity, quick search focus, session exit.

---

## Architectural Process Orchestration

```
AdminLayoutComponent mounts app-navbar
        ▼
toggleSidebar() → SidebarStateService.toggle()
        ▼
Profile menu → AuthStore.user(), logout → /auth/login
        ▼
Ctrl+K / HostListener → focusSearch() on [data-global-search]
```

Mounted alongside sidebar; z-index 100 (below sidebar overlay 150+).

---

## Key Controller/Service Capabilities

| Member | Role |
|--------|------|
| `authStore` | User name, avatar URL, logout |
| `sidebarState` | Hamburger toggle |
| `showProfile` | Dropdown open state |
| `initials()` | Avatar fallback from fullName |
| `onLogout()` | `authStore.logout()` + navigate login |
| `focusSearch()` | DOM query `[data-global-search]` |
| `@HostListener document:keydown` | Ctrl/Cmd+K → focus search |

Template/HTML in `navbar.component.html`; styles in `navbar.component.scss`.

---

## Critical Design Considerations

- **OnPush + signals** — profile menu local state only.
- **No breadcrumb** — despite `BreadcrumbComponent` existing; not included in navbar.
- **Search is UI-only** — input has no `(input)` handler or search service wiring.

---

## Gotchas & Best Practices

- Profile dropdown shows hardcoded subtitle **"UI/UX Designer"** in HTML—not from user roles.
- Layout, Language, Notifications buttons have **no click handlers** (placeholders).
- `focusSearch` uses `document.querySelector`—fragile if multiple search inputs exist.
- Navbar always visible; sidebar slides over content when open.

---

## Architectural Advice & Refactoring

**Wire:** Global search command palette or route-aware search. **Fix:** Display real role from `authStore.user().roles`. **Add:** `<app-breadcrumb>` in topbar left. **Remove:** Dead icon buttons or implement features.

---

## Navigation Strategy

Next: `navbar.component.html_explanation.md`, `sidebar-state.service_explanation.md`, `admin-layout.component_explanation.md`.
