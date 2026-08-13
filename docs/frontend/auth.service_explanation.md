# `auth.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/auth.service.ts`

---

## Executive Summary

`AuthService` is the **HTTP client for all authentication flows**: login (including MFA branch), registration, token refresh, and password reset/OTP. It maps Spring Boot `/api/auth/*` responses into typed RxJS observables consumed by login/register components and optionally `AuthStore`.

**Business value:** Single entry point for IAM before users reach CAN features guarded by `authGuard`.

---

## Architectural Process Orchestration

```
LoginComponent / SignUpComponent / ForgotPassword flows
        ▼
AuthService.login / register / mfaVerify / …
        ▼
POST /api/auth/*  (public paths — no Bearer on login)
        ▼
AuthController (Java) → UserEntity, JWT issuance, MFA
        ▼
On success: AuthStore.setAuth() (in component, not this service)
        ▼
Subsequent CAN API calls use access_token via authInterceptor
```

**MFA branch:** Login returns HTTP **202** with `MfaAuthResponse` → `MfaStateService` holds token → `mfaVerify` completes auth.

---

## Key Controller/Service Capabilities

| Method | Endpoint | Returns |
|--------|----------|---------|
| `login(email, password)` | `POST /login` | `LoginResult`: `{ type: 'success', data: AuthResponse }` or `{ type: 'mfa_required', … }` (status 202) |
| `mfaVerify(mfaToken, code)` | `POST /mfa/verify` | `AuthResponse` |
| `register(name, email, password)` | `POST /register` | `AuthResponse` |
| `refresh(refreshToken)` | `POST /refresh` | `AuthResponse` |
| `forgotPassword(email)` | `POST /forgot-password` | `void` |
| `verifyOtp(email, code)` | `POST /verify-otp` | `{ resetToken, expiresInSeconds }` |
| `resetPassword(resetToken, newPassword)` | `POST /reset-password` | `void` |

Uses `{ observe: 'response' }` on login to distinguish 200 vs 202.

---

## Critical Design Considerations

- **Does not touch AuthStore** — components must call `setAuth` after success (separation of HTTP vs state).
- **Public auth URLs** listed in `app.config.ts` `PUBLIC_AUTH_PATHS` — must stay in sync when adding endpoints.
- **No token refresh loop** — `refresh()` exists but no global 401 auto-refresh interceptor wired.

---

## Gotchas & Best Practices

- Login errors trigger **global errorInterceptor toasts** — coordinate with form `errorMessage`.
- `refresh()` not automatically called on 401.
- Register field `name` must match backend `RegisterRequest` contract.

---

## Architectural Advice & Refactoring

**Add:** Auto-refresh on 401; move `setAuth` into service after login success. **Correct:** Wire refresh token rotation with `AuthStore.setAccessToken` + localStorage. **Remove:** Nothing.

---

## Navigation Strategy

Next: `store/auth.store.ts`, `mfa-state.service.ts`, `features/auth/login/login.component.ts`, backend `AuthController.java`.
