# `sniffer.component.scss` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/sniffer.component.scss`

---

## Executive Summary

`sniffer.component.scss` (~930 lines) is the **KPIT dark-theme stylesheet** for the sniffer feature: lime accent (`#b0ff44`), near-black backgrounds, session sidebar primitives, filters, table/charts/integrity layouts, and loading skeletons.

**Business value:** Visual consistency for the CAN analyser; pairs with `sniffer.component.html` and is partially overridden when embedded in `CanWorkspaceComponent`.

---

## Architectural Process Orchestration

```
sniffer.component.html class names
        ▼
SCSS sections apply layout + theme
        ▼
CanWorkspace ::ng-deep .kpit-sniffer-layout { height:100% }
  (layout wrapper hidden: .kpit-sniffer-layout { display:none })
```

Primary active root: `.kpit-sniffer-content` (flex column, full height).

---

## Key Controller/Service Capabilities

| Section | Classes (representative) |
|---------|--------------------------|
| Layout | `.kpit-sniffer-content`, `.kpit-sniffer-layout` (hidden) |
| Left panel (legacy) | `.kpit-left-panel`, `.kpit-session-list`, `.kpit-session-item`, `.kpit-load-more` |
| Stats / filters | `.kpit-stats-bar`, `.kpit-filter-group`, `.kpit-checklist` |
| Session header | `.kpit-session-header`, `.kpit-live-badge`, `.kpit-view-tabs` |
| Table | `.kpit-table-wrap`, frame table overrides |
| Charts | `.kpit-charts-area`, `.kpit-charts-grid`, `.kpit-cmt-btn` |
| Integrity | `.kpit-integrity-area`, `.kpit-fault-item` |
| Motion | `@keyframes shimmer`, `@keyframes pulse` |

Color tokens: background `#07090b` / `#0d1117`, borders `rgba(176,255,68,0.1)`, muted text `#8a9ab0`.

---

## Critical Design Considerations

- **Legacy left panel styles** remain while UI moved to `can-workspace` inline styles—duplicate session-list styling in two places.
- **`.kpit-sniffer-layout { display: none }`** — old two-column shell disabled; workspace expects deep override.
- **Component-scoped** — no global CSS variables; hard-coded hex throughout.

---

## Gotchas & Best Practices

- Editing workspace left panel won't change sniffer SCSS session styles (and vice versa).
- Monitor theme (`kpitMonitorChartTheme` input) may rely on classes documented in monitor SCSS, not all defined here.
- Large file—search by section comment (`/* ═══ LAYOUT ═══ */`) when navigating.

---

## Architectural Advice & Refactoring

**Add:** Shared `_kpit-can-theme.scss` partial imported by sniffer + workspace. **Remove:** Unused `.kpit-sniffer-layout` / left-panel block or re-enable for standalone route. **Consolidate:** Duplicate session row styles with workspace.

---

## Navigation Strategy

Next: `can-workspace.component.ts` inline styles, `monitor-page` chart theme if present.
