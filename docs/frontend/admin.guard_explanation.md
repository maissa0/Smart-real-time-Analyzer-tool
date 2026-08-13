# `admin.guard.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/auth/admin.guard.ts`

---

## Executive Summary

`adminGuard` restricts **admin-only routes** to users whose `User.roles` include **`Admin`** or **`ROLE_ADMIN`**. Non-admins who attempt to activate a protected route are redirected to `/admin` (dashboard) rather than login—they remain authenticated but lack privilege.

**Business value:** Separates **authentication** (any logged-in user can use CAN tools) from **authorization** (user management requires admin role), mirroring backend RBAC on `UserControllerV1` endpoints.

---

## Architectural Process Orchestration

```
Authenticated user (passed authGuard on /admin)
        │
        navigates to /admin/users/list
        │
        ▼
users.routes.ts  canActivate: [adminGuard]
        │
        ▼
adminGuard (this file)
        ├── authStore.user()?.roles
        ├── some(r => r.name === 'Admin' || r.name === 'ROLE_ADMIN')
        │
        ├─ isAdmin ──► true → UserListComponent loads
        └─ NOT admin ──► UrlTree → /admin (dashboard)
                │
                ▼
UserListComponent → UserStore → GET /api/v1/users (backend also enforces admin)
```

**Backend alignment:** Java Spring Security should reject non-admin calls to user APIs regardless of this guard. The guard is **UX**, not security boundary.

**Current usage (grep):** Only `features/users/users.routes.ts` → `path: 'list'`.

**Sidebar note:** Admin nav link for Users is often wrapped in `@if (isAdmin())` in sidebar—parallel UI check, not this guard.

---

## Key Controller/Service Capabilities

| Export | Type | Responsibility |
|--------|------|----------------|
| `adminGuard` | `CanActivateFn` | Role name check on `AuthStore.user().roles` |

**Logic:**

```typescript
const isAdmin = user?.roles?.some(
  r => r.name === 'Admin' || r.name === 'ROLE_ADMIN'
) ?? false;

if (isAdmin) return true;
return router.createUrlTree(['/admin']);
```

**No inputs/parameters**—hard-coded role name strings.

---

## Critical Design Considerations

- **Role name string matching:** Supports both `'Admin'` (display name from API) and `'ROLE_ADMIN'` (Spring-style)—handles inconsistency between backend DTO naming and Spring defaults.
- **Soft redirect:** Sends non-admins to dashboard, not 403 page—friendly but may confuse users who bookmarked `/admin/users/list`.
- **Depends on login payload:** Roles must be present on `User` object stored in `AuthStore` at login; if backend omits roles from JWT/login response, guard always fails.
- **Does not check permissions slugs:** Unlike `permissionGuard`, this is **role-based**, not fine-grained.

---

## Gotchas & Best Practices

| Gotcha | Detail |
|--------|--------|
| **Dual role naming** | `'Admin'` vs `'ROLE_ADMIN'` suggests backend inconsistency—document canonical role name in one place. |
| **Not used on settings/audit** | Audit log routes may be admin-only in backend but not guarded here—verify route config. |
| **Stale roles** | Role changes server-side require re-login to update `auth_user` in localStorage. |
| **Empty roles array** | Non-admin users with missing `roles` field treated as non-admin (`?? false`). |

**Best practice:** Prefer **permission slugs** (`user:read`) over role names for new routes—use `permissionGuard` when backend exposes permissions consistently.

---

## Architectural Advice & Refactoring

### What to Add

- Central **`isAdmin(user: User | null): boolean`** helper in `core/auth/auth.utils.ts` shared with sidebar `isAdmin()`.
- **403 or "Access denied" route** instead of silent redirect to dashboard.
- Apply `adminGuard` to **audit log** and other admin-only settings routes if missing.

### What to Correct

- Align with backend: single role identifier (`ROLE_ADMIN` enum or slug).
- Ensure `AuthResponse` always includes `roles[]` on login.

### What to Get Rid Of

- Duplicate `isAdmin` logic scattered in `sidebar.component.ts`—consolidate to one function.

---

## Navigation Strategy

**Next files:**

1. `features/users/users.routes.ts` — sole consumer of `adminGuard`.
2. `features/users/user-list/user-list.component.ts` — admin UI entry.
3. `shared/layout/sidebar/sidebar.component.ts` — parallel admin visibility check.
4. Backend `RoleEntity` / `UserControllerV1` — authoritative role names.
5. `core/auth/permission.guard.ts` — finer-grained alternative.

---

## Source Reference

```typescript
export const adminGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router    = inject(Router);

  const user = authStore.user();
  const isAdmin = user?.roles?.some(
    r => r.name === 'Admin' || r.name === 'ROLE_ADMIN'
  ) ?? false;

  if (isAdmin) return true;
  return router.createUrlTree(['/admin']);
};
```
