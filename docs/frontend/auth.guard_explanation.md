# `auth.guard.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/auth/auth.guard.ts`

---

## Executive Summary

`authGuard` is the **primary route protection gate** for the authenticated area of the SPA. It is a functional `CanActivateFn` that blocks unauthenticated users from entering `/admin/**` and redirects them to `/auth/login`. It also enforces **account active status**: disabled users are logged out client-side and sent back to login with `?reason=disabled`.

**Business value:** Ensures only logged-in, active users reach CAN analysis, fleet, catalog, and dashboard features—aligned with Spring Security JWT enforcement on the backend (UI gate is complementary, not sufficient alone).

---

## Architectural Process Orchestration

```
User navigates to /admin/...
        │
        ▼
app.routes.ts  canActivate: [authGuard]
        │
        ▼
authGuard (this file)
        ├── inject(AuthStore)  ← hydrated from localStorage on app boot
        ├── inject(Router)
        │
        ├─ NOT isAuthenticated() ──► UrlTree → /auth/login
        ├─ user.isActive === false ──► authStore.logout() + /auth/login?reason=disabled
        └─ else ──► true (allow child routes)
                │
                ▼
        AdminLayoutComponent + lazy feature routes
                │
                ▼
        HttpClient requests → authInterceptor attaches Bearer token → Java :8080
```

**Downstream guards:** `adminGuard` on `/admin/users/list` runs **after** `authGuard` on the parent `/admin` tree (user must already be authenticated).

**Python/Kafka:** No direct interaction. Guard only gates Angular routing before any CAN pipeline UI loads.

---

## Key Controller/Service Capabilities

| Export | Type | Responsibility |
|--------|------|----------------|
| `authGuard` | `CanActivateFn` | Synchronous route activation check |

**Decision logic (in order):**

1. **`!authStore.isAuthenticated()`** → redirect to `/auth/login` (no query params).
2. **`user && !user.isActive`** → call `authStore.logout()`, redirect to `/auth/login?reason=disabled`.
3. **Otherwise** → return `true`.

**Dependencies injected at runtime:**

- `AuthStore` — reads `isAuthenticated()`, `user()`.
- `Router` — builds `UrlTree` for redirects (preferred over `navigate()` in guards).

---

## Critical Design Considerations

- **Functional guard (Angular 15+):** Uses `inject()` inside `CanActivateFn` instead of class-based `CanActivate`—matches modern Angular standalone style.
- **Client-side only:** `isAuthenticated` is true if `AuthStore` has a token from `localStorage`; **expired JWT** is not validated here—backend returns 401 on first API call.
- **Disabled account handling:** Proactively clears tokens via `logout()` so stale credentials are not reused; pairs with `LoginComponent` reading `reason=disabled`.
- **Applied at parent route:** Single `canActivate: [authGuard]` on `/admin` protects **all** child routes (workspace, sniffer, fleet, catalogs, users, settings).

---

## Gotchas & Best Practices

| Gotcha | Detail |
|--------|--------|
| **Token presence ≠ valid session** | User may pass guard with expired JWT until an API fails. |
| **`isActive` depends on login payload** | If `auth_user` in localStorage is stale and admin disables account server-side, guard won't know until next login or profile refresh. |
| **No return URL** | Redirect to login does not preserve intended deep link (`returnUrl` query param not implemented). |
| **Logout on disabled check** | Side effect inside guard—acceptable but makes unit testing guard behavior require mocking `AuthStore.logout`. |

**Best practice:** Keep this guard **thin**—authentication yes/no + obvious client checks only; authorization (roles/permissions) belongs in `adminGuard` / `permissionGuard`.

---

## Architectural Advice & Refactoring

### What to Add

- **`returnUrl` query param** when redirecting unauthenticated users: `/auth/login?returnUrl=/admin/workspace`.
- Optional **JWT expiry check** (decode `exp` claim) before allowing `/admin`.
- **`canMatch` or child guard** on sensitive routes if you split public `/admin` previews later.

### What to Correct

- Consider syncing `isActive` from a lightweight `/api/v1/profile/me` ping on app init for long-lived sessions.

### What to Get Rid Of

- Nothing in this file—avoid adding role/permission logic here (already split to other guards).

---

## Navigation Strategy

**Next files to investigate:**

1. `store/auth.store.ts` — how `isAuthenticated` and `user` are populated.
2. `app.routes.ts` — where `authGuard` is registered.
3. `core/auth/admin.guard.ts` — role-based restriction on user admin routes.
4. `features/auth/login/login.component.ts` — handles `reason=disabled` UX.
5. `app.config.ts` — JWT interceptor (parallel auth path).

---

## Source Reference

```typescript
export const authGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    return router.createUrlTree(['/auth/login']);
  }

  const user = authStore.user();
  if (user && !user.isActive) {
    authStore.logout();
    return router.createUrlTree(['/auth/login'], {
      queryParams: { reason: 'disabled' },
    });
  }

  return true;
};
```

**Registered in:** `app.routes.ts` → `path: 'admin', canActivate: [authGuard]`.
