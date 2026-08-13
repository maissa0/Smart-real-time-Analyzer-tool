# `sidebar.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/layout/sidebar/sidebar.component.ts`

---

## Executive Summary

`SidebarComponent` is the **slide-out navigation drawer** for the admin app: route links to dashboard, workspace, catalogs, fleet, settings, and admin-only Users. Open/close state comes from `SidebarStateService`; admin gating uses role name check on `AuthStore`.

**Business value:** Primary feature navigation map for the CAN analyser product.

---

## Architectural Process Orchestration

```
Navbar hamburger → SidebarStateService.toggle()
        ▼
Sidebar [class.open] when isOpen()
        ▼
Nav link click → close() (auto-collapse on navigate)
        ▼
RouterLinkActive highlights current route
        ▼
Users link rendered only if isAdmin()
```

Always in DOM; off-screen until `.open` (see SCSS).

---

## Key Controller/Service Capabilities

| Member | Role |
|--------|------|
| `isOpen` | Readonly ref to `sidebarState.isOpen` signal |
| `isAdmin()` | `roles.some(r => r.name === 'Admin')` |
| `close()` | `sidebarState.close()` |
| `authStore` | Injected for role check |

Imports: `RouterLink`, `RouterLinkActive`. Template in HTML file.

---

## Critical Design Considerations

- **Role-based, not permission-based** — does not use `HasPermissionDirective` or permission slugs.
- **No sniffer route** — `/admin/sniffer` exists in routes but not listed in sidebar (workspace is primary CAN entry).
- **OnPush** — updates when sidebar signal or auth user changes.

---

## Gotchas & Best Practices

- Admin check uses exact role name `'Admin'`—must match backend role seeding.
- Sidebar closed by default (`isOpen` false)—mobile-first overlay pattern.
- `isAdmin` is a method called from template—re-evaluates each CD cycle (acceptable for small tree).

---

## Architectural Advice & Refactoring

**Add:** Sniffer link or document workspace as canonical entry. **Use:** Permission slugs for finer nav hiding. **Centralize:** Nav config array (label, path, icon, guard) instead of static HTML.

---

## Navigation Strategy

Next: `sidebar.component.html_explanation.md`, `app.routes.ts`, `admin.guard_explanation.md`.
