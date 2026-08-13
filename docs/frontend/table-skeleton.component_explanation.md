# `table-skeleton.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/components/skeleton/table-skeleton.component.ts`

---

## Executive Summary

`TableSkeletonComponent` renders a **fake HTML table** with pulsing header and cell placeholders—configurable row and column counts via computed index arrays.

**Business value:** Table-shaped loading state for paginated admin lists.

**Note:** **Not referenced** in any feature component today.

---

## Architectural Process Orchestration

```
[rowCount] [columnCount] inputs (defaults 5×5)
        ▼
computed rows/columns → @for loops
        ▼
Static table markup with animate-pulse divs
```

---

## Key Controller/Service Capabilities

| Input | Default |
|-------|---------|
| `rowCount` | 5 |
| `columnCount` | 5 |

Tailwind: white background, gray borders—light admin table aesthetic.

---

## Critical Design Considerations

- **Self-contained inline template** — no external HTML/SCSS.
- **OnPush + computed** — regenerates arrays when counts change.

---

## Gotchas & Best Practices

- Orphan component—`UserListComponent` implements its own loading text instead.
- Light theme (`bg-white`, `border-gray-200`) clashes with KPIT dark pages.
- Pairs conceptually with `DataTableComponent` but not wired together.

---

## Architectural Advice & Refactoring

**Wire:** `user-list`, `audit-log` loading states. **Unify:** Single skeleton module exporting bar + table. **Theme:** Dark variant input.

---

## Navigation Strategy

Next: `data-table.component_explanation.md`, `user-list.component.html_explanation.md`.
