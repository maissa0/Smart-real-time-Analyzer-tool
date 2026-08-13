# `auth.store.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/store/auth.store.ts`

---

## Executive Summary

`AuthStore` is the **client-side source of truth for authentication state**: logged-in user, JWT access/refresh tokens, and **permission slugs** for RBAC. It hydrates from `localStorage` on startup so page refreshes keep the session, and synchronizes writes when login/logout/profile updates occur.

**Business value:** Centralizes IAM state for guards, directives, and HTTP interceptors—bridging Spring Security JWT responses with Angular UI visibility rules.

---

## Architectural Process Orchestration

```
Java AuthController (/api/auth/login, /refresh, …)
        │ JSON AuthResponse (user + tokens + permissions)
        ▼
AuthService (core/services/auth.service.ts) — HTTP layer
        │ calls setAuth()
        ▼
AuthStore (this file)
        ├── localStorage: access_token, refresh_token, auth_user, auth_permissions
        └── in-memory signals: user, isAuthenticated, permissions[]
                │
                ├── authGuard → blocks /admin if !isAuthenticated
                ├── authInterceptor (app.config.ts) → reads access_token directly from localStorage
                └── HasPermissionDirective → hasPermission(slug)
```

**Note:** The HTTP interceptor reads **`localStorage` directly**, not `AuthStore.accessToken()`—two parallel token sources that must stay in sync via `setAuth` / `logout`.

**Python/Kafka:** No direct coupling. CAN pipeline endpoints still require the JWT this store manages.

---

## Key Controller/Service Capabilities

| Method / computed | Responsibility |
|-------------------|----------------|
| `getInitialState()` | On store init: rebuild state from `localStorage` if `access_token` exists |
| `permissionSlugs` | Computed alias of `permissions` signal |
| `currentUser` | Computed alias of `user` |
| `loggedIn` | Computed alias of `isAuthenticated` |
| `hasPermission(slug)` | Returns `permissions.includes(slug)` — used by `HasPermissionDirective` |
| `setAuth(payload)` | Persist tokens + user + permission slugs; set `isAuthenticated: true` |
| `setAccessToken(token)` | Patch access token only (e.g. after refresh)—**does not update localStorage** |
| `updateUser(user)` | Patch user in memory + `auth_user` in localStorage |
| `logout()` | Clear all auth keys from localStorage; reset to `initialState` |

---

## Critical Design Considerations

- **@ngrx/signals `signalStore`:** Zoneless-friendly reactive store with `withState`, `withComputed`, `withMethods`.
- **`providedIn: 'root'`:** Singleton across the app.
- **Permission model:** Stores flat **slug strings** (`user:write`), not full `Permission` objects—matches backend RBAC checks.
- **SSR-safe guard:** `typeof localStorage === 'undefined'` returns empty initial state (future SSR compatibility).

---

## Gotchas & Best Practices

| Gotcha | Impact |
|--------|--------|
| **`setAccessToken` skips localStorage** | Interceptor reads `localStorage.getItem('access_token')`—refresh flow must update localStorage or API calls fail after refresh. |
| **Stale permissions** | Role changes on server are not reflected until re-login unless you add a permissions refresh endpoint. |
| **Token in localStorage** | XSS can steal tokens—acceptable for dev/PFE; production may prefer httpOnly cookies. |
| **`isAuthenticated` without token validation** | Store trusts presence of token string; expired JWT may still show as logged-in until API returns 401. |

**Best practice:** After token refresh, call a method that updates **both** store and `localStorage`, or refactor interceptor to inject `AuthStore`.

---

## Architectural Advice & Refactoring

### What to Add

- `setAccessToken` should mirror token to `localStorage.setItem('access_token', token)`.
- Optional `hydrateFromToken()` that validates JWT expiry client-side.
- `permissions` refresh on profile load or periodic sync with `/api/v1/users/me`.

### What to Correct

- Unify token access: **single source** (store OR localStorage, not both).
- Align `setAccessToken` with interceptor expectations.

### What to Get Rid Of

- Redundant computed aliases if unused (`permissionSlugs` duplicates `permissions` unless templates depend on the name).

---

## Navigation Strategy

**Next files:**

1. `core/services/auth.service.ts` — login/register/refresh HTTP mapping to `setAuth`.
2. `core/auth/auth.guard.ts` — route protection using this store.
3. `app.config.ts` — `authInterceptor` token attachment (verify sync with store).
4. `core/auth/admin.guard.ts` / `permission.guard.ts` — role vs permission routing.

---

## Source Reference (critical methods)

```typescript
hasPermission(permissionSlug: string): boolean {
  return store.permissions().includes(permissionSlug);
}

setAuth(payload: { user; accessToken; refreshToken?; permissions? }): void {
  // writes localStorage + patchState
}

logout(): void {
  // clears localStorage + patchState(initialState)
}
```
