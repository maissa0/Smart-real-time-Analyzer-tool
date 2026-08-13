# `mfa-verify.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/mfa-verify/mfa-verify.component.ts`

---

## Executive Summary

`MfaVerifyComponent` completes **login-time MFA** at `/auth/mfa-verify`. After `LoginComponent` receives HTTP 202, the user enters a 6-digit TOTP code; the component calls `AuthService.mfaVerify(mfaToken, code)`, hydrates `AuthStore`, clears `MfaStateService`, and redirects to the admin app.

**Business value:** Second factor gate for MFA-enabled accounts—fully wired unlike the password-recovery OTP screen (`code-verification`).

**Note:** Template is **inline** in this file (no separate `.html`).

---

## Architectural Process Orchestration

```
LoginComponent (202 MFA)
        ▼
MfaStateService.setToken(mfaToken)
        ▼
Navigate /auth/mfa-verify
        ▼
User enters 6-digit code → onSubmit()
        ▼
POST /api/auth/mfa/verify { mfaToken, code }  (public path)
        ▼
Backend validates TOTP → AuthResponse
        ▼
mfaState.clear()
AuthStore.setAuth(user, accessToken, refreshToken, permissions)
        ▼
router → /admin/users/list
        ▼
Subsequent requests: authInterceptor Bearer token

Missing token path:
getToken() null → error message → redirect /auth/login
```

No CAN/Kafka involvement.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `form.code` | Required, `Validators.pattern(/^\d{6}$/)` |
| `isSubmitting` | Disables submit; “Verifying...” label |
| `errorMessage` | Missing token, invalid code, API message |
| `onSubmit()` | Guard token → `authService.mfaVerify` → `setAuth` → navigate |

**Inline template:** branded auth card, single numeric input (`inputmode="numeric"`, `maxlength="6"`), submit button.

**Injected:** `AuthService`, `AuthStore`, `MfaStateService`, `Router`, `FormBuilder`.

---

## Critical Design Considerations

- **In-memory `mfaToken`** — page refresh loses token; user must re-login (by design in `MfaStateService`).
- **6-digit code** — matches authenticator TOTP; differs from **4-digit** email OTP in forgot-password flow.
- **Same post-auth destination as login** — `/admin/users/list` (hard-coded).
- **Standalone + OnPush** — signals for loading/error; reactive form for code.
- **No route guard** — direct URL access without prior login shows “Session expired” and redirects.

---

## Gotchas & Best Practices

- **`isSubmitting` not cleared on success** — harmless (component destroyed on navigate).
- **Dual error UX** — `errorInterceptor` may toast while inline `errorMessage` also shows.
- No “back to login” link in template—only automatic redirect when token missing.
- **`MfaStateService.clear()`** not called on error—user can retry with same token until expiry.
- Compare with **`CodeVerificationComponent`** — UI-only recovery OTP, 4 digits, no API.

---

## Architectural Advice & Refactoring

**Add:** Route guard requiring `mfaState.mfaToken()`; back link to login; clear `mfaState` on login page entry. **Correct:** Role-based redirect instead of fixed `/admin/users/list`. **Correct:** Reset `isSubmitting` in `next` for consistency. **Remove:** Nothing critical.

---

## Navigation Strategy

Next: `login.component_explanation.md`, `mfa-state.service_explanation.md`, `auth.service_explanation.md`, backend `AuthController` MFA verify endpoint.
