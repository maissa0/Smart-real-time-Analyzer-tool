# `data-table.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/components/data-table/data-table.component.html`

---

## Executive Summary

Template for **`DataTableComponent`**: bordered white card table, sortable headers, default or template-driven cells, empty state, and footer pagination controls.

**Business value:** Declarative markup for reusable admin tables—separates presentation from TS pagination logic.

---

## Architectural Process Orchestration

```
Table wrapper (.overflow-x-auto, border-able-border)
        ▼
thead: *ngFor columns → sort button if sortable
        ▼
tbody: empty row OR *ngFor processedData()
  ├─ custom ngTemplateOutlet if cellTemplates match
  └─ else getFieldValue(row, field)
        ▼
Optional actions column via actionsTemplate
        ▼
Footer if totalCount > 0: range text, page size select, Prev/Next
```

---

## Key Controller/Service Capabilities

| Region | Bindings |
|--------|----------|
| Headers | `columns()`, `onSort(col)`, `isSorted(col)`, `sortDirection()` |
| Rows | `processedData()`, `getCellTemplate(col)`, `getFieldValue` |
| Actions | `actionsTemplate()` with `{ $implicit: row }` |
| Empty | colspan spans all columns |
| Footer | `currentPage()`, `pageSize()`, `totalCount()`, `totalPages()`, `Math.min`, `goToPage`, `setPageSize` |

Uses legacy `*ngFor` / `*ngIf` structural directives (CommonModule).

---

## Critical Design Considerations

- **Custom classes** `border-able-border`, `shadow-able-card` — assume global/Tailwind theme tokens.
- **Whitespace nowrap** on cells—wide tables scroll horizontally.
- **Actions header** hard-coded English "Actions".

---

## Gotchas & Best Practices

- Template/context keys must match `DataTableCellContext` (`$implicit`, `column`, `index`).
- No row click handler—parent must use custom cell template.
- Footer hidden when `totalCount() === 0` (including empty data).

---

## Architectural Advice & Refactoring

**Migrate:** To `@for` control flow for consistency with newer features. **Add:** `@if` loading row with `app-table-skeleton`. **i18n:** Extract header strings.

---

## Navigation Strategy

Next: `data-table.component_explanation.md`, `table-skeleton.component_explanation.md`.
