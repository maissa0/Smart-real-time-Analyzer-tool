# `skeleton.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/components/skeleton/skeleton.component.ts`

---

## Executive Summary

`SkeletonComponent` renders a **single shimmer placeholder bar** with configurable Tailwind height/width classes. Used for loading states before real content appears.

**Business value:** Reusable loading UX primitive—intended for admin pages with async data.

**Note:** **Not currently used** in any feature template (grep shows definition only).

---

## Architectural Process Orchestration

```
Parent sets [height] [width] [class] inputs
        ▼
app-skeleton renders animated div
        ▼
Replaced by real content when data loads
```

Inline template + local `@keyframes shimmer` styles.

---

## Key Controller/Service Capabilities

| Input | Default behavior |
|-------|------------------|
| `height` | Falls back to `h-4` |
| `width` | Falls back to `w-full` |
| `class` | Extra Tailwind classes |

Light gray gradient animation (`#f3f4f6` / `#e5e7eb`)—**light theme**, unlike KPIT dark admin pages.

---

## Critical Design Considerations

- **Presentational only** — no service coupling.
- **OnPush** — inputs via signal `input()`.
- **Theme mismatch** — gray shimmer vs app `#07090b` dark shell.

---

## Gotchas & Best Practices

- Unused in codebase—features use inline skeletons (e.g. sniffer SCSS `@keyframes shimmer`).
- Requires Tailwind `animate-pulse` and height/width utilities in build.

---

## Architectural Advice & Refactoring

**Adopt:** Replace inline loading blocks in list pages. **Restyle:** Dark-theme shimmer to match KPIT palette. **Remove:** If `TableSkeletonComponent` covers all cases.

---

## Navigation Strategy

Next: `table-skeleton.component_explanation.md`, feature inline skeletons in sniffer SCSS.
