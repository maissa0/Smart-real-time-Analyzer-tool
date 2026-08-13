# `breadcrumb.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/components/breadcrumb/breadcrumb.component.ts`

---

## Executive Summary

`BreadcrumbComponent` renders a **navigation breadcrumb trail** driven by `BreadcrumbService.items()`. It shows Home → nested route segments with links for intermediate steps and plain text for the current page.

**Business value:** Orientation inside the deep `/admin/*` hierarchy (workspace, sniffer, fleet, settings)—reduces disorientation in a multi-feature SPA.

---

## Architectural Process Orchestration

```
Feature component or layout (caller — often missing today)
        │ breadcrumbService.set([...]) or setFromPath('/admin/fleet')
        ▼
BreadcrumbService (signal: _items)
        ▼
BreadcrumbComponent (reads breadcrumbService.items())
        │ RouterLink for non-terminal crumbs
        ▼
User navigates via Angular Router
```

**Cross-stack:** Pure frontend navigation—no Java/Python/Kafka. Indirectly helps users reach pages that **then** call backend APIs.

**Important:** This component **does not auto-populate** breadcrumbs from the router; something must call `BreadcrumbService.set()` or `setFromPath()`. Verify callers in layout or feature components.

---

## Key Controller/Service Capabilities

### BreadcrumbComponent

| Member | Responsibility |
|--------|----------------|
| `breadcrumbService` | Injected readonly reference for template |
| Template `@for (item of breadcrumbService.items())` | Renders list with chevron separators |
| Last item | Rendered as `<span>` (current page, not linked) |
| Non-last with `url` | `<a [routerLink]>` |
| Non-last without `url` | Plain `<span>` |

### BreadcrumbService (dependency)

| Method | Responsibility |
|--------|----------------|
| `set(items)` | Replace full breadcrumb array |
| `setFromPath(path, labels?)` | Build crumbs from URL segments; prefixes `{ label: 'Home', url: '/admin' }` |
| `clear()` | Empty trail |
| `items` | Readonly signal accessor |

---

## Critical Design Considerations

- **Presentational component:** Zero business logic; delegates state to service—good separation.
- **OnPush + signals:** Reads service signal in template—updates when service mutates.
- **Inline template:** Keeps component file self-contained; Tailwind-style utility classes for styling.
- **Accessibility:** `aria-label="Breadcrumb"` on `<nav>`.

---

## Gotchas & Best Practices

| Gotcha | Detail |
|--------|--------|
| **Manual updates required** | Router navigation alone won't update crumbs unless a listener calls `setFromPath`. |
| **Empty items** | If never set, breadcrumb renders empty `<ol>`—verify navbar includes this component and something sets items. |
| **Hard-coded Home → `/admin`** | In service, not component—changing landing route requires service edit. |
| **track $index** | Reordering items may reuse DOM oddly; prefer `track item.url` or `track item.label`. |

---

## Architectural Advice & Refactoring

### What to Add

- **Router listener** in `BreadcrumbService` or `AdminLayoutComponent`:

  ```typescript
  router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(...)
  ```

  Auto-call `setFromPath(router.url)`.

- **Route `data: { breadcrumb: 'Fleet' }`** in `app.routes.ts` for i18n-friendly labels.

### What to Correct

- Move breadcrumb population to **admin layout** so all child routes inherit updates.
- Replace `track $index` with stable track key.

### What to Get Rid Of

- Duplicate breadcrumb markup if any feature inlines its own trail—use this component only.

---

## Navigation Strategy

**Next files:**

1. `core/services/breadcrumb.service.ts` — full API and `setFromPath` algorithm.
2. `shared/layout/navbar/navbar.component.ts` — verify `<app-breadcrumb>` usage.
3. `layouts/admin-layout/admin-layout.component.ts` — ideal place to wire router → breadcrumb.
4. `app.routes.ts` — route `data` for labels.

---

## Source Reference

```typescript
@Component({
  selector: 'app-breadcrumb',
  template: `
    <nav class="flex" aria-label="Breadcrumb">
      <ol class="flex items-center gap-2 text-sm">
        @for (item of breadcrumbService.items(); track $index; let last = $last) {
          ...
        }
      </ol>
    </nav>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BreadcrumbComponent {
  readonly breadcrumbService = inject(BreadcrumbService);
}
```
