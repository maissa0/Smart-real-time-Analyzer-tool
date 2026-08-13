# `login.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/login/login.component.ts`

---

## Executive Summary

`LoginComponent` is the **primary authentication entry point** at `/auth/login` (and default `/auth` redirect). It submits email/password via `AuthService.login`, branches on MFA (HTTP 202) vs success (200), hydrates `AuthStore`, and redirects into the admin app—or shows inline errors alongside global toasts.

**Business value:** Gates access to the entire CAN analyser admin surface (`authGuard` on `/admin`); only fully wired step in the auth feature set.

---

## Architectural Process Orchestration

```
User → /auth/login
        ▼
loginForm (email, password) → onSubmit()
        ▼
AuthService.login → POST /api/auth/login (public, no Bearer)
        ▼
┌─ 202 MFA ─────────────────────────────────────────────┐
│  MfaStateService.setToken(mfaToken)                   │
│  router → /auth/mfa-verify                            │
└───────────────────────────────────────────────────────┘
┌─ 200 success ─────────────────────────────────────────┐
│  AuthStore.setAuth(user, tokens, permissions)         │
│  localStorage: access_token, refresh_token, …         │
│  router → /admin/users/list                           │
└───────────────────────────────────────────────────────┘
┌─ error ───────────────────────────────────────────────┐
│  errorInterceptor → ToastService                      │
│  errorMessage signal → inline alert                   │
└───────────────────────────────────────────────────────┘

Return path: authGuard denies disabled user → /auth/login?reason=disabled
        ▼
ngOnInit reads reason → sets “Account Disabled” message
```

Subsequent API calls use `access_token` via `authInterceptor` in `app.config.ts`.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `loginForm` | Reactive group: `email`, `password`, `keepSignedIn` (unused in submit) |
| `isLoading` | Disables submit; spinner in template |
| `errorMessage` | Inline alert; cleared on submit; preset for `?reason=disabled` |
| `passwordVisible` | Toggles password input type |
| `onSubmit()` | Calls `AuthService.login`, handles MFA vs success vs error |
| `togglePasswordVisibility()` | UX helper |
| `ngOnInit()` | Query param `reason=disabled` from `authGuard` logout |

**Injected:** `AuthStore`, `AuthService`, `MfaStateService`, `Router`, `ActivatedRoute`, `NgZone`.

---

## Critical Design Considerations

- **MFA branch** — uses `LoginResult` discriminated union from `AuthService` (200 vs 202).
- **`NgZone.run()`** — wraps navigation/state updates (zoneless app compatibility).
- **Hard-coded post-login route** — `/admin/users/list`, not `/admin` dashboard or `returnUrl`.
- **`keepSignedIn`** — form field present; **no effect** on token persistence (always uses localStorage in `AuthStore`).
- **Dual error UX** — interceptor toast + component `errorMessage` (possible duplicate feedback).

---

## Gotchas & Best Practices

- Navigating to **`/admin/users/list`** may hit **`adminGuard`**—non-admin users could bounce after successful login.
- Invalid credentials: generic message regardless of 401 vs 403 backend body.
- Social OAuth buttons in template have **no `(click)` handlers**—decorative only.
- `isLoading` not cleared if early `return` after invalid form (guarded by invalid check before set true).
- MFA path does not clear `MfaStateService` on login page entry (cleared on mfa-verify success).

---

## Architectural Advice & Refactoring

**Add:** `returnUrl` query support; use `keepSignedIn` for sessionStorage vs localStorage; redirect to `/admin` or role-based home. **Correct:** Deduplicate error display (toast OR inline). **Remove:** Dead social buttons or implement OAuth.

---

## Navigation Strategy

Next: `login.component.html`, `auth.store_explanation.md`, `auth.service_explanation.md`, `mfa-verify/`, `auth.guard_explanation.md`.
