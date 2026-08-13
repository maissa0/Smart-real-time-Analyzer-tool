# `audit-log.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/settings/audit-log/audit-log.component.html`

---

## Executive Summary

This template renders the **audit log table UI**: optional header/breadcrumb (standalone mode), loading spinner, sortable-style table columns, empty state, and a **metadata JSON modal** overlay.

**Business value:** Readable compliance view with monospace action badges and one-click metadata inspection.

---

## Architectural Process Orchestration

```
@if (!embedded()) → title + app-breadcrumb
        ▼
isLoading() → spinner
        ▼
@for (logs()) → table rows
        ▼
View JSON → onViewMetadata(log)
        ▼
selectedLog() → fixed modal with <pre> block
```

Template binds to component signals only.

---

## Key Controller/Service Capabilities

| UI block | Behavior |
|----------|----------|
| Header | Hidden when `embedded()` |
| Columns | DATE, ACTION, RESOURCE, IP, DETAILS |
| Action badge | Green pill with `log.action` |
| Metadata | Button if `log.metadata` truthy |
| Modal | Click backdrop to close |
| Empty | “No audit logs found” |

Date format: `dd/MM/yyyy HH:mm`. Inline dark-theme styles throughout.

---

## Critical Design Considerations

- **Modal in same template** — not a separate component; `z-index: 50`.
- **Scroll** — table max-height 480px with overflow.
- **Inline `@keyframes spin`** at bottom of file.

---

## Gotchas & Best Practices

- Modal not in `@if (embedded())` guard—works in both modes.
- Row hover uses inline `onmouseover` handlers.
- No `source` column displayed though `AuditLog.source` exists in model.
- Accessibility: modal lacks `role="dialog"` / focus trap.

---

## Architectural Advice & Refactoring

**Add:** `aria-modal`, focus trap, `source` badge column. **Correct:** Extract modal component. **Remove:** Nothing.

---

## Navigation Strategy

Next: `audit-log.component.ts`, `audit-log.model_explanation.md`.
