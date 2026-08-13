# `data-table.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/components/data-table/data-table.component.ts`

---

## Executive Summary

`DataTableComponent<T>` is a **generic data table** with client- or server-side pagination, column sorting, custom cell templates, and an optional actions column. Generic over row type `T extends object`.

**Business value:** Reusable admin table to replace duplicated HTML tables (users, audit log, fleet).

**Note:** **Not mounted** in any feature yet—ready infrastructure.

---

## Architectural Process Orchestration

```
Parent provides [data] [columns]
        ▼
Optional: [serverTotalCount] + [currentPageInput] → server mode
        ▼
processedData computed:
  - client: sort + slice by page/pageSize
  - server: return data as-is (parent fetches page)
        ▼
User sorts → sortChange output (client sort skipped if serverTotalCount set)
User paginates → pageChange / pageSizeChange outputs
        ▼
Template renders rows (see data-table.component.html)
```

---

## Key Controller/Service Capabilities

| Input | Purpose |
|-------|---------|
| `data` | Row array (required) |
| `columns` | `DataTableColumn<T>[]` (required) |
| `cellTemplates` | Map templateKey → TemplateRef |
| `actionsTemplate` | Right column actions |
| `pageSizeOptions`, `defaultPageSize` | Pagination UI |
| `serverTotalCount` | Enables server-side mode |
| `currentPageInput` | Sync page from parent store |

| Output | Event |
|--------|-------|
| `sortChange` | `{ sortBy, sortDirection }` |
| `pageChange` | page number |
| `pageSizeChange` | new size |

Internal signals: `_currentPage`, `_pageSize`, `_sortBy`, `_sortDirection`. Effects sync `defaultPageSize` and `currentPageInput`.

Helpers: `getFieldValue` (dot paths), `compare`, `onSort`, `goToPage`, `setPageSize`, `getCellTemplate`.

---

## Critical Design Considerations

- **Dual mode:** When `serverTotalCount != null`, sorting is delegated to parent (no client sort); data assumed pre-paged.
- **OnPush + signals** — Angular 17+ `input()` / `output()` API.
- **Template in external HTML** — uses `*ngFor` (not `@for`) in template file.

---

## Gotchas & Best Practices

- Server mode still emits `sortChange` but does not sort locally—parent must refetch.
- `currentPageInput` effect resets internal page when parent changes filter.
- Light Tailwind styling in HTML—not KPIT dark theme.
- `UserStore` pagination could wire via `serverTotalCount` + `pageChange`.

---

## Architectural Advice & Refactoring

**Wire:** `UserListComponent` as first consumer. **Add:** Loading/empty slots via ng-content. **Theme:** Dark SCSS variant or CSS variables.

---

## Navigation Strategy

Next: `data-table.component.html_explanation.md`, `user.store_explanation.md`, `data-table-column.interface_explanation.md`.
