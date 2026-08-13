# `data-table-column.interface.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/components/data-table/data-table-column.interface.ts`

---

## Executive Summary

Type definitions for **`DataTableComponent`**: column config, custom cell template context, and actions column context. Enables typed generic tables with optional custom rendering.

**Business value:** Contract between table component and consuming features—sort keys, field paths, template keys.

---

## Architectural Process Orchestration

```
Feature defines DataTableColumn<T>[]
        ▼
Passed to app-data-table [columns]
        ▼
Optional cellTemplates map keyed by templateKey
        ▼
Template receives DataTableCellContext<T>
```

---

## Key Controller/Service Capabilities

| Type | Fields |
|------|--------|
| `DataTableColumn<T>` | `key`, `header`, `field?`, `sortable?`, `templateKey?`, `headerClass?`, `cellClass?` |
| `DataTableCellContext<T>` | `$implicit: T`, `column`, `index?` |
| `DataTableActionsContext<T>` | `$implicit: T` |

`field` supports dot paths via component `getFieldValue()`.

---

## Critical Design Considerations

- **Type-only file** — no runtime exports except types (erased at compile).
- **`key` vs `field`** — sort uses `field ?? key`; display uses same for default cells.

---

## Gotchas & Best Practices

- Not used by any feature yet—interfaces ready for adoption.
- `field?: keyof T | string` allows nested paths as strings.
- Actions column separate from `columns` array—uses `actionsTemplate` input.

---

## Architectural Advice & Refactoring

**Add:** `align`, `width`, `hidden` column options if needed. **Export:** From feature barrels when user list migrates to data-table.

---

## Navigation Strategy

Next: `data-table.component.ts`, `data-table.component.html`, `data-table.index_explanation.md`.
