# `sidebar.component.scss` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/layout/sidebar/sidebar.component.scss`

---

## Executive Summary

Stylesheet for **`SidebarComponent`** (~106 lines): off-canvas drawer animation, dimmed backdrop overlay, nav link hover/active states, and KPIT lime accent on active route.

**Business value:** Drawer UX that overlays main content without reserving horizontal layout space.

---

## Architectural Process Orchestration

```
Default: .kpit-sidebar { left: -280px } (hidden off-screen)
        ▼
.open → left: 0 (slide in, 0.28s easing)
        ▼
@if open: .kpit-overlay z-index 150 blocks clicks to main
        ▼
Nav items: hover + .kpit-nav-active from RouterLinkActive
```

Sidebar z-index **200**—above navbar (100) and overlay (150).

---

## Key Controller/Service Capabilities

| Rule | Purpose |
|------|---------|
| `.kpit-overlay` | Full-screen dim + blur when open |
| `.kpit-sidebar` | 260px width, fixed full height |
| `.kpit-sidebar.open` | Visible state |
| `.kpit-nav-item` / `.kpit-nav-active` | Link styling, left border accent |
| `.kpit-nav-icon` | 16px SVG stroke icons |

Unused in HTML: `.kpit-nav-dot` (legacy dot indicator class).

---

## Critical Design Considerations

- **Width mismatch:** hidden at `-280px` but width `260px`—intentional overshoot for animation.
- **No responsive permanent dock** — always overlay drawer, never pinned open on desktop.
- **Header min-height 52px** — aligns visually with navbar height.

---

## Gotchas & Best Practices

- Main content does not shift when sidebar opens—content stays full width under overlay.
- Scroll contained in sidebar via `overflow-y: auto`.
- `.kpit-nav-active` uses `!important` to beat hover styles.

---

## Architectural Advice & Refactoring

**Add:** Desktop breakpoint with optional pinned sidebar + main margin-left. **Remove:** Unused `.kpit-nav-dot`. **Share:** Color tokens with navbar SCSS partial.

---

## Navigation Strategy

Next: `sidebar-state.service_explanation.md`, `navbar.component.scss_explanation.md`, `admin-layout.component_explanation.md`.
