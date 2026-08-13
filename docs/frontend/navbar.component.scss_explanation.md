# `navbar.component.scss` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/layout/navbar/navbar.component.scss`

---

## Executive Summary

Stylesheet for **`NavbarComponent`** (~234 lines): fixed top bar, KPIT dark theme with lime accent (`#b0ff44`), search field, icon buttons, avatar, profile dropdown, and notification dot.

**Business value:** Visual consistency for admin chrome; height `52px` drives main content offset in `admin-layout.component.scss`.

---

## Architectural Process Orchestration

```
navbar.component.html class names
        ▼
SCSS rules (component-scoped)
        ▼
Fixed .kpit-topbar at z-index 100
        ▼
admin-layout .kpit-main-content { padding-top: 52px }
```

---

## Key Controller/Service Capabilities

| Section | Classes |
|---------|---------|
| Bar shell | `.kpit-topbar`, `.kpit-topbar-left`, `.kpit-topbar-right` |
| Brand | `.kpit-brand`, `.kpit-brand-accent` |
| Search | `.kpit-nav-search-wrap`, `.kpit-nav-search-input`, `.kpit-kbd` |
| Actions | `.kpit-hamburger`, `.kpit-icon-btn` |
| Profile | `.kpit-avatar-btn`, `.kpit-avatar-circle`, `.kpit-dropdown*` |
| Overlay | `.kpit-overlay-click` (z-index 40, below dropdown 50) |

Responsive: `.kpit-kbd` hidden below 640px.

---

## Critical Design Considerations

- **Hard-coded 52px height** — must match admin layout padding-top.
- **Z-index stack:** topbar 100, profile overlay 40, dropdown 50, sidebar overlay 150+ when open.
- **No CSS variables** — hex/rgba literals throughout.

---

## Gotchas & Best Practices

- Dropdown uses absolute positioning under avatar—may clip on small viewports.
- Lime focus ring on search matches KPIT brand but differs from light shared components (toast, data-table).
- `.kpit-notify-dot` always visible—implies unread notifications without logic.

---

## Architectural Advice & Refactoring

**Extract:** Shared `_kpit-chrome.scss` with navbar + sidebar tokens. **Add:** `--kpit-topbar-height` custom property. **Dark/light:** Not applicable—admin is dark-only here.

---

## Navigation Strategy

Next: `admin-layout.component.scss_explanation.md`, `sidebar.component.scss_explanation.md`.
