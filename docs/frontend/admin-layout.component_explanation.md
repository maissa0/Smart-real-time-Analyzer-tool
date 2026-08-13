# `admin-layout.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/layouts/admin-layout/admin-layout.component.ts`

---

## Executive Summary

`AdminLayoutComponent` is the **authenticated app shell** for all `/admin/*` routes: fixed navbar, slide-out sidebar, and a `<router-outlet>` main area. It is a thin composition root with no business logic—children lazy-load feature modules.

**Business value:** One consistent chrome (navigation, branding, logout) wrapping dashboard, sniffer, workspace, fleet, users, settings, and profile.

---

## Architectural Process Orchestration

```
User passes authGuard on path 'admin'
        ▼
loadComponent → AdminLayoutComponent
        ├─ app-navbar (fixed top bar, 52px)
        ├─ app-sidebar (fixed overlay drawer)
        └─ main.kpit-main-content → router-outlet
                ▼
        Child routes: '', sniffer, workspace, catalogs, fleet, users, settings, profile
```

Auth routes (`/auth/*`) **do not** use this layout—they render full-page auth forms.

---

## Key Controller/Service Capabilities

| Piece | Role |
|-------|------|
| `RouterOutlet` | Renders active admin child route |
| `NavbarComponent` | Top bar: hamburger, search focus, profile menu, logout |
| `SidebarComponent` | Nav links; admin-only items via `AuthStore` |
| Template | Inline (~8 lines)—`.kpit-layout` wrapper |
| `styleUrl` | `admin-layout.component.scss` |

Standalone, `ChangeDetectionStrategy.OnPush`, empty class body.

---

## Critical Design Considerations

- **Layout-only component** — no injects, no lifecycle hooks.
- **Guard on parent** — `authGuard` on `admin` route in `app.routes.ts`; layout assumes authenticated session.
- **Fixed chrome + padded main** — SCSS offsets main content `padding-top: 52px` for navbar; sidebar slides over content (does not reserve horizontal margin).
- **Tailwind + SCSS** — template adds `p-6` on main while SCSS also sets min-height/padding-top.

---

## Gotchas & Best Practices

- **Full-viewport features** (e.g. `CanWorkspaceComponent` with `height: 100vh`) may fight layout padding—features often use their own full-height styles.
- Sidebar/navbar documented separately under `shared/layout/` (not yet audited).
- Only one layout variant today—no separate “minimal” or “embedded” layout.

---

## Architectural Advice & Refactoring

**Add:** `router-outlet` scroll restoration or dedicated content wrapper without double padding. **Extract:** Template to `.html` if layout grows (footer, breadcrumbs slot). **Consider:** Second layout for full-bleed workspace without `p-6`.

---

## Navigation Strategy

Next: `admin-layout.component.scss`, `app.routes.ts`, `sidebar.component.ts`, `navbar.component.ts`, `auth.guard_explanation.md`.
