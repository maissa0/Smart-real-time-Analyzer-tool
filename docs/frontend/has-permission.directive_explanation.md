# `has-permission.directive.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/directives/has-permission.directive.ts`

---

## Executive Summary

`HasPermissionDirective` is a **structural directive** (`*appHasPermission`) that **shows or hides DOM** based on whether the current user holds a given **permission slug**. It connects RBAC data from `AuthStore` to template-level UI gating without duplicating `*ngIf` logic in every component.

**Business value:** Enforces least-privilege UX—buttons and panels for admin actions disappear for unauthorized users, aligned with Spring Security permissions on the backend (UI is not security—API still must reject).

---

## Architectural Process Orchestration

```
Java login → AuthResponse.permissions[]
        ▼
AuthStore.setAuth() → permissions: string[] (slugs)
        ▼
HasPermissionDirective (effect)
        │ reads appHasPermission input + authStore.hasPermission()
        ▼
ViewContainerRef.createEmbeddedView | clear()
        ▼
User sees/hides UI element
```

**Parallel enforcement:**

- **Backend:** `@PreAuthorize` / method security on controllers—**authoritative**.
- **Frontend:** This directive—**convenience only**; never trust for security.

**Kafka/Python:** No interaction.

---

## Key Controller/Service Capabilities

| API | Responsibility |
|-----|----------------|
| `selector: '[appHasPermission]'` | Attribute/structural directive |
| `appHasPermission = input.required<string>()` | Permission slug to check (e.g. `'user:write'`) |
| `constructor()` + `effect()` | Reactive re-render when permission input or auth state changes |
| `authStore.hasPermission(permission)` | Delegates to store slug array |

**Usage (from file comment):**

```html
<button *appHasPermission="'user:write'">Edit</button>
```

---

## Critical Design Considerations

- **Structural directive pattern:** Creates/destroys embedded views—lighter than CSS `display:none` for large subtrees.
- **Angular `effect()` in constructor:** Zoneless-compatible; re-runs when signals read inside effect change.
- **`input.required<string>()`:** Signal input API (Angular 17+); slug must be provided at compile/template time.
- **Standalone directive:** Import where needed; not globally declared.

---

## Gotchas & Best Practices

| Gotcha | Detail |
|--------|--------|
| **UI-only security** | Hidden buttons can still be invoked via DevTools/API—backend must enforce. |
| **Stale permissions** | If roles change server-side, UI won't update until re-login. |
| **Effect + createEmbeddedView** | Calling `createEmbeddedView` on every effect run **without checking if view exists** may duplicate views in some Angular versions—current code clears first via if/else branch (only one branch runs). |
| **Single permission only** | No `*appHasPermission="['a','b']"` OR logic—would need extension. |
| **Not adopted in templates** | Grep shows no feature imports `HasPermissionDirective`—sidebar uses `isAdmin()` role check instead; RBAC UI gating is mostly manual or route guards. |
| **createEmbeddedView on every effect run** | When permission flips true repeatedly, may stack duplicate views unless cleared first—current if/else clears on false but does not guard against double create on true without clear. |

**Best practice:** Pair every slug used here with a matching backend permission check and integration test.

---

## Architectural Advice & Refactoring

### What to Add

- **`appHasAnyPermission` / `appHasAllPermissions`** variants for composite rules.
- **Role-based sibling:** `HasRoleDirective` if you use role names vs slugs inconsistently.
- **Dev-mode warning** when slug is unknown/empty string.

### What to Correct

- Consider tracking embedded view ref to avoid recreate churn on unrelated auth signal updates.
- Document canonical slug list next to backend `PermissionEntity` seeds.

### What to Get Rid Of

- Duplicate manual `*ngIf="authStore.hasPermission(...)"` in templates once directive is adopted consistently.

---

## Navigation Strategy

**Next files:**

1. `store/auth.store.ts` — `hasPermission` implementation and permission hydration.
2. `core/auth/permission.guard.ts` — route-level permission checks (if used).
3. `shared/directives/` — any other RBAC directives.
4. Backend `PermissionEntity` / `RoleControllerV1` — slug source of truth.

---

## Source Reference

```typescript
@Directive({ selector: '[appHasPermission]', standalone: true })
export class HasPermissionDirective {
  readonly appHasPermission = input.required<string>();

  constructor() {
    effect(() => {
      const permission = this.appHasPermission();
      if (this.authStore.hasPermission(permission)) {
        this.viewContainer.createEmbeddedView(this.templateRef);
      } else {
        this.viewContainer.clear();
      }
    });
  }
}
```
