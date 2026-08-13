# `navbar.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/layout/navbar/navbar.component.html`

---

## Executive Summary

Template for the **KPIT admin top bar** (~120 lines): hamburger, brand, search input with Ctrl+K hint, three decorative icon buttons, and avatar profile dropdown with Profile link and Logout.

**Business value:** Primary shell UI users interact with on every authenticated page.

---

## Architectural Process Orchestration

```
<header class="kpit-topbar">
  ├─ Left: hamburger → toggleSidebar(), brand text
  └─ Right: search + kbd hint + icon stubs + profile
        ├─ overlay click → closeProfile()
        ├─ routerLink /admin/profile
        └─ onLogout()
```

Uses `@if` for profile dropdown and avatar image vs initials.

---

## Key Controller/Service Capabilities

| Region | Bindings |
|--------|----------|
| Hamburger | `(click)="toggleSidebar()"` |
| Search | `data-global-search`, placeholder only |
| Profile | `showProfile()`, `authStore.user()`, `initials()` |
| Dropdown | `closeProfile()`, `onLogout()`, `routerLink="/admin/profile"` |

Tailwind utility classes mixed with KPIT SCSS classes (`flex`, `min-w-0`, `h-5 w-5` on icons).

---

## Critical Design Considerations

- **Fixed header** — pairs with `.kpit-topbar` SCSS (52px height).
- **Notification dot** — decorative `.kpit-notify-dot` without real notification state.
- **Avatar** — optional `avatarUrl` image or initials span.

---

## Gotchas & Best Practices

- Hardcoded `kpit-dropdown-role`: "UI/UX Designer".
- Search input does not emit events—Ctrl+K only focuses field.
- `#profileContainer` template ref declared but unused in TS.
- No `<app-breadcrumb>` in navbar.

---

## Architectural Advice & Refactoring

**Replace:** Static role with dynamic role label. **Implement or hide:** layout/language/notification buttons. **Connect:** Search to fleet/users/session global find.

---

## Navigation Strategy

Next: `navbar.component.scss_explanation.md`, `breadcrumb.component_explanation.md`.
