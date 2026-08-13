# `auth.model.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/models/auth.model.ts`

---

## Executive Summary

`auth.model.ts` defines the **authentication response DTOs** returned by Spring Boot `/api/auth/*`: full success payload (`AuthResponse`) and MFA challenge payload (`MfaAuthResponse`). These are the primary shapes `AuthService.login` discriminates on HTTP 200 vs 202.

**Business value:** Typed contract for login/register/refresh/MFA flows; bridges JWT issuance to `AuthStore` hydration.

---

## Architectural Process Orchestration

```
POST /api/auth/login
        ▼
200 → AuthResponse          202 → MfaAuthResponse
        ▼                           ▼
AuthService LoginResult      MfaStateService.setToken(mfaToken)
        ▼                           ▼
AuthStore.setAuth(user,      POST /api/auth/mfa/verify → AuthResponse
  accessToken, permissions)
        ▼
authInterceptor attaches accessToken to CAN API calls
```

References Frontend Integration Guide sections 1.1.1 and 2.

---

## Key Controller/Service Capabilities

| Interface | Key fields | When used |
|-----------|------------|-----------|
| `AuthResponse` | `user`, `accessToken`, `refreshToken`, `tokenType`, `expiresIn`, `permissions` | Login success, register, refresh, MFA verify |
| `MfaAuthResponse` | `mfaRequired`, `mfaToken` | Login when MFA enabled |

Composes `User` and `Permission` from sibling model files.

---

## Critical Design Considerations

- **Flat token fields** — camelCase matches Jackson serialization from Java.
- **`permissions` duplicated** — also nested on `User` in some responses; `AuthStore` typically uses top-level list.
- **No runtime code** — interfaces only.

---

## Gotchas & Best Practices

- `expiresIn` is seconds—convert for token expiry UI if implemented.
- `refreshToken` stored in `AuthStore`/localStorage but **auto-refresh not wired** globally.
- Must handle both response types in login component before calling `setAuth`.

---

## Architectural Advice & Refactoring

**Add:** Discriminated union type exported for `LoginResult`. **Correct:** Single source for permissions (response vs user object). **Remove:** Nothing.

---

## Navigation Strategy

Next: `auth.service_explanation.md`, `auth.store_explanation.md`, `user.model.ts`, backend `AuthResponse.java`.
