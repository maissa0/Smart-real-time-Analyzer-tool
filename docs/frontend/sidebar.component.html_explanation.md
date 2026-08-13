# `sidebar.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/layout/sidebar/sidebar.component.html`

---

## Executive Summary

Template for the **KPIT sidebar navigation** (~86 lines): backdrop overlay when open, brand header with close button, and vertical nav links with SVG icons and `routerLinkActive` styling.

**Business value:** Declarative map of top-level admin features users can reach from any page.

---

## Architectural Process Orchestration

```
@if isOpen() → .kpit-overlay (click close)
        ▼
<nav class="kpit-sidebar" [class.open]="isOpen()">
  ├─ Header: brand + close
  └─ .kpit-nav-links
        ├─ /admin (exact dashboard)
        ├─ /admin/workspace
        ├─ /admin/catalogs
        ├─ /admin/fleet
        ├─ @if isAdmin() → /admin/users/list
        ├─ divider
        └─ /admin/settings
```

Each link `(click)="close()"` to dismiss drawer after navigation.

---

## Key Controller/Service Capabilities

| Link | Route | Notes |
|------|-------|-------|
| Dashboard | `/admin` | `routerLinkActiveOptions exact: true` |
| CAN Workspace | `/admin/workspace` | |
| ECU Catalogs | `/admin/catalogs` | |
| Fleet | `/admin/fleet` | |
| Users | `/admin/users/list` | Admin only |
| Settings | `/admin/settings` | |

Active class: `kpit-nav-active`. Icons inline SVG per item.

---

## Critical Design Considerations

- **Missing routes in nav:** `/admin/sniffer`, `/admin/profile` (profile via navbar only).
- **Settings** visible to all authenticated users—not admin-guarded at nav level (child routes may guard).
- Inline divider style on `<div>` between Fleet and Settings.

---

## Gotchas & Best Practices

- Long SVG path for Settings gear—inflates template size.
- No `@if` for permission-based feature flags beyond Users admin block.
- Overlay uses `role="presentation"`—sidebar itself lacks `aria-label`.

---

## Architectural Advice & Refactoring

**Add:** Profile or sniffer entries if product requires. **Extract:** Nav items to config TS array + `@for`. **i18n:** Label strings. **A11y:** `aria-expanded` on hamburger side (navbar) + `nav aria-label`.

---

## Navigation Strategy

Next: `sidebar.component.scss_explanation.md`, `can-workspace.component_explanation.md`, `users.routes_explanation.md`.
