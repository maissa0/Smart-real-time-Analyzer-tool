# `breadcrumb.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/breadcrumb.service.ts`

---

## Executive Summary

`BreadcrumbService` holds **reactive breadcrumb trail state** as a signal array of `{ label, url? }`. Features or layout code call `set()` or `setFromPath()` to populate navigation context consumed by `BreadcrumbComponent`.

**Business value:** Centralizes breadcrumb data so the shared navbar component stays dumb and reusable across `/admin/*` routes.

---

## Architectural Process Orchestration

```
(Route change — ideally layout/feature)
        ▼
BreadcrumbService.setFromPath('/admin/fleet') or .set([...])
        ▼
_items signal updates
        ▼
BreadcrumbComponent reads items() in template
        ▼
RouterLink navigation
```

**No HTTP/backend** — pure UI state. Not auto-wired to Angular Router today unless a caller invokes `setFromPath`.

---

## Key Controller/Service Capabilities

| Method | Responsibility |
|--------|----------------|
| `items` | Readonly signal of `BreadcrumbItem[]` |
| `set(items)` | Replace trail explicitly |
| `setFromPath(path, labels?)` | Build crumbs from URL segments; prefix Home → `/admin` |
| `clear()` | Empty trail |
| `formatLabel(seg)` | kebab-case → Title Case |

---

## Critical Design Considerations

- **Signal store pattern** — private `_items` + public readonly accessor.
- **Home always `/admin`** — hard-coded in `setFromPath`.

---

## Gotchas & Best Practices

- **Nothing calls this automatically** — empty breadcrumbs unless wired in layout.
- Last crumb still gets `url` in `setFromPath` — component treats last as non-link via `@last`.

---

## Architectural Advice & Refactoring

**Add:** Router `NavigationEnd` listener in `AdminLayoutComponent`. **Correct:** Route `data.breadcrumb` labels. **Remove:** Duplicate manual breadcrumbs in features.

---

## Navigation Strategy

Next: `shared/components/breadcrumb/breadcrumb.component.ts`, `layouts/admin-layout/admin-layout.component.ts`.
