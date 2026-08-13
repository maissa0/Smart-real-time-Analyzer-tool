# `set-password.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/set-password/set-password.component.ts`

---

## Executive Summary

`SetPasswordComponent` is the **invitation / first-login password activation** screen at `/auth/set-password?token=…`. It reads a `resetToken` from the query string, validates matching passwords, and **POSTs to `/api/auth/set-password`**—the only fully wired password-set flow in the auth feature (unlike stub `reset-password`).

**Business value:** Activates invited users when an admin sends an invitation email with a time-limited link (`UserServiceV1` → `EmailService.sendInvitationEmail`).

**Note:** Inline **template** and **styles** in this file (no separate `.html` / `.scss`).

---

## Architectural Process Orchestration

```
Admin invite → backend generates resetToken (15 min TTL)
        ▼
Email link: /auth/set-password?token={resetToken}
        ▼
SetPasswordComponent.ngOnInit — read token from queryParams
        ▼
User submits password + confirm
        ▼
POST /api/auth/set-password { resetToken, newPassword }  (public)
        ▼
AuthController.setPassword → AuthService.resetPassword (same handler)
        ▼
User password hash updated, account activated
        ▼
success UI → goToLogin() → /auth/login
```

Parallel path **`/auth/reset-password`** (forgot-password OTP) should use same body shape via `AuthService.resetPassword` but is **not implemented** in UI today.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `token` | From `?token=` query param (private field) |
| `tokenMissing` | No token → “Invalid or expired link” panel |
| `form` | `password` (min 8), `confirm` + group `passwordMatchValidator` |
| `saving` | Loading during HTTP |
| `serverError` | API error message inline |
| `success` | Post-submit confirmation + login button |
| `onSubmit()` | `HttpClient.post` to set-password endpoint |
| `goToLogin()` | Navigate `/auth/login` |

**Three template branches:** `@if (success())` | `@else if (tokenMissing())` | `@else` form.

Uses **raw `HttpClient`** — not `AuthService` (which exposes `resetPassword` for `/reset-password` only, not `/set-password`).

---

## Critical Design Considerations

- **Same DTO as reset** — backend `ResetPasswordRequest`: `resetToken`, `newPassword`.
- **Custom styling** — component-scoped `.sp-*` classes, not shared `auth-card` layout used by login/forgot-password.
- **Standalone + OnPush** — signals for UI state; reactive forms with cross-field validator.
- **Token in URL** — standard for email links; sensitive in browser history/referrer logs.

---

## Gotchas & Best Practices

- **Hard-coded invite URL on backend** — `http://localhost:4200/auth/set-password?token=…` in `UserServiceV1` (dev-only host).
- **`errorInterceptor`** may duplicate toast + inline `serverError`.
- Query param named **`token`** but POST field is **`resetToken`** — naming inconsistency only at URL layer.
- Expired token: API error message shown; UI copy mentions 15 min limit.
- Do not confuse with **`ResetPasswordComponent`** — UI stub, no HTTP.

---

## Architectural Advice & Refactoring

**Add:** `AuthService.setPassword(resetToken, newPassword)` wrapper; use `Router` snapshot + subscribe for query param changes. **Correct:** Environment-based frontend URL in backend invite emails. **Remove:** Direct `HttpClient` if consolidating auth API in service layer.

---

## Navigation Strategy

Next: `reset-password.component_explanation.md`, `user-list` invite flow, backend `UserServiceV1` invitation, `EmailService.sendInvitationEmail`, `AuthController.setPassword`.
