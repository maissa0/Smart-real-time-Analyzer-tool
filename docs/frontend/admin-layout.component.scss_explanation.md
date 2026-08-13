# `admin-layout.component.scss` — Architecture Explanation

**Source:** `Frontend_angular/src/app/layouts/admin-layout/admin-layout.component.scss`

---

## Executive Summary

`admin-layout.component.scss` is a **minimal stylesheet** (~9 lines) for the admin shell: full-viewport dark background and main content offset below the fixed 52px navbar.

**Business value:** Ensures routed feature pages sit below the top bar and inherit the KPIT near-black page background (`#07090b`).

---

## Architectural Process Orchestration

```
admin-layout.component.ts template
        ▼
.kpit-layout wraps navbar + sidebar + main
        ▼
.kpit-main-content receives router-outlet children
        ▼
padding-top: 52px aligns with navbar.component.scss (.kpit-topbar height)
```

Sidebar positioning lives in `sidebar.component.scss` (fixed overlay)—not in this file.

---

## Key Controller/Service Capabilities

| Rule | Purpose |
|------|---------|
| `.kpit-layout` | `min-height: 100vh`, `background: #07090b` |
| `.kpit-main-content` | `padding-top: 52px`, `min-height: calc(100vh - 52px)` |

No media queries, variables, or sidebar margin rules.

---

## Critical Design Considerations

- **Navbar height coupling** — `52px` must stay in sync with `.kpit-topbar { height: 52px }` in navbar SCSS.
- **No left inset** — main content spans full width; sidebar overlays when open.
- **Template also uses `p-6`** — Tailwind adds 1.5rem padding on all sides in addition to top offset from SCSS.

---

## Gotchas & Best Practices

- Changing navbar height requires updating both layout SCSS and navbar SCSS.
- Feature pages that set `min-height: 100vh` on their own root may double-count top padding visually.
- Very small file—most visual chrome styling is in navbar/sidebar/feature components.

---

## Architectural Advice & Refactoring

**Add:** CSS custom property `--kpit-topbar-height: 52px` shared across layout and navbar. **Remove:** Redundant `p-6` from template or move all spacing into SCSS for one source of truth.

---

## Navigation Strategy

Next: `navbar.component.scss`, `sidebar.component.scss`, `admin-layout.component_explanation.md`.
