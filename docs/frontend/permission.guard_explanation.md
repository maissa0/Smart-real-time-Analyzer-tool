# `permission.guard.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/auth/permission.guard.ts`

---

## Executive Summary

`permissionGuard` is a **factory function** that produces a `CanActivateFn` bound to a specific **permission slug** (e.g. `'user:write'`). Routes can declare `canActivate: [permissionGuard('some:slug')]` to allow navigation only when `AuthStore.hasPermission(slug)` returns true.

**Business value:** Enables **fine-grained route-level RBAC** aligned with permission slugs from the Java backend—more flexible than hard-coded role names in `adminGuard`.

---

## Architectural Process Orchestration

```
Java AuthController login response
        │ permissions: Permission[] → slugs stored in AuthStore
        ▼
Route definition (intended usage):
  canActivate: [authGuard, permissionGuard('fleet:write')]
        │
        ▼
permissionGuard('fleet:write') → CanActivateFn
        │
        ├── authStore.hasPermission('fleet:write')
        │         └── permissions.includes(slug)
        │
        ├─ true ──► activate route
        └─ false ──► UrlTree → /admin
```

**Current repo status:** As of this audit, **`permissionGuard` is defined but not referenced in any `*.routes.ts` file**. Only `authGuard` and `adminGuard` are wired. This is **latent infrastructure**—ready to use but inactive.

**Related UI mechanism:** `HasPermissionDirective` (`*appHasPermission`) hides elements by the same slug logic but does not protect route URLs.

---

## Key Controller/Service Capabilities

| Export | Signature | Responsibility |
|--------|-----------|----------------|
| `permissionGuard` | `(permission: string) => CanActivateFn` | Factory returning closure over slug |

**Generated guard behavior:**

1. `inject(AuthStore)` + `inject(Router)`.
2. If `authStore.hasPermission(permission)` → `true`.
3. Else → `router.createUrlTree(['/admin'])`.

**Example intended usage (not yet in codebase):**

```typescript
{
  path: 'sensitive',
  loadComponent: () => import('./...'),
  canActivate: [authGuard, permissionGuard('catalog:admin')],
}
```

---

## Critical Design Considerations

- **Higher-order guard pattern:** Common Angular pattern for parameterized guards without class injection tokens.
- **Composable with `authGuard`:** Should always run **after** `authGuard` so unauthenticated users hit login first—order matters in `canActivate` array.
- **Slug strings are magic strings:** No compile-time check that slug exists in backend seed data.
- **Same redirect as `adminGuard`:** Non-authorized users go to `/admin`, not login—implies "logged in but not allowed."

---

## Gotchas & Best Practices

| Gotcha | Detail |
|--------|--------|
| **Unused in routes** | Dead code path until wired—easy to forget during feature work. |
| **No authGuard bundled** | Calling `permissionGuard` alone on a public parent would still allow anonymous access if parent isn't protected. |
| **Permission list stale** | Same as `HasPermissionDirective`—re-login required after admin grants new permissions. |
| **Typo in slug** | `'user:write'` vs `'users:write'` fails closed (redirect dashboard)—hard to debug. |

**Best practice:** Define permission slugs as **`const` enum or union type** shared with backend OpenAPI/codegen if available.

---

## Architectural Advice & Refactoring

### What to Add

- **`PERMISSIONS` constant object** in `data/models/permission.model.ts` with all slugs.
- Wire guards on routes that need finer control than `adminGuard` (e.g. catalog upload, fleet delete).
- Optional **`permissionGuardAny(...slugs)`** for OR semantics.

### What to Correct

- Either **adopt this guard in routes** or document why `adminGuard` + directive suffice—reduce dead code confusion.
- Redirect to dedicated **403 component** with message instead of silent dashboard bounce.

### What to Get Rid Of

- If team standardizes on roles only, this file could merge with admin guard—but permissions are richer; prefer **using** it rather than removing.

---

## Navigation Strategy

**Next files:**

1. `store/auth.store.ts` — `hasPermission()` and permission hydration from login.
2. `shared/directives/has-permission.directive.ts` — template-level twin of this guard.
3. `data/models/permission.model.ts` — slug definitions.
4. Backend `PermissionEntity` / seed data — source of truth for slugs.
5. `app.routes.ts` / feature `*.routes.ts` — candidates to attach this guard.

---

## Source Reference

```typescript
export const permissionGuard = (permission: string): CanActivateFn => {
  return () => {
    const authStore = inject(AuthStore);
    const router = inject(Router);
    if (authStore.hasPermission(permission)) {
      return true;
    }
    return router.createUrlTree(['/admin']);
  };
};
```
