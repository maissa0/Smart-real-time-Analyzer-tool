# `reset-password.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/reset-password/reset-password.component.ts`

---

## Executive Summary

`ResetPasswordComponent` is the **final UI step of the forgot-password wizard** at `/auth/reset-password`. It collects new password + confirmation and, on valid submit, waits 1.5s then navigates to login—**without calling `AuthService.resetPassword()` and without a `resetToken` from OTP verification**.

**Business value:** Placeholder for setting a new password after email OTP; `AuthService.resetPassword(resetToken, newPassword)` and backend `POST /api/auth/reset-password` already exist but are unused here.

---

## Architectural Process Orchestration

```
(Intended recovery chain)
forgot-password → verify-code → verifyOtp → { resetToken }
        ▼
ResetPasswordComponent — new password form
        ▼
POST /api/auth/reset-password { resetToken, newPassword }
        ▼
Navigate /auth/login

(Current implementation)
code-verification (stub) → /auth/reset-password (no token passed)
        ▼
onSubmit() → submitted.set(true) → setTimeout 1500ms → /auth/login
(no HTTP, no resetToken)
```

Public route; endpoint in `PUBLIC_AUTH_PATHS`. Compare **`SetPasswordComponent`** (`/auth/set-password`) which **does** POST with token from query string.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `form.password` | Required, `minLength(8)` |
| `form.confirmPassword` | Required only — **no match validator** |
| `submitted` | Set true on submit — **not used in template** |
| `onSubmit()` | If valid → flag + delayed navigation |

**Not used:** `AuthService`, `ActivatedRoute`, router state, `resetToken`, loading/error signals.

---

## Critical Design Considerations

- **Standalone + OnPush** — minimal component; external HTML template.
- **Weaker validation** — passwords can mismatch and form still submits (both fields merely required).
- **Dead signal** — `submitted` has no template branch (unlike forgot-password success UI).

---

## Gotchas & Best Practices

- **Broken recovery chain** — upstream steps also skip API (`forgot-password`, `code-verification`).
- User believes password changed; **backend password unchanged**.
- No strength rules beyond 8 chars (backend may enforce more).
- **`set-password` route** may be the real token-based flow for invites—avoid confusing the two in docs/navigation.
- `errorInterceptor` never runs without HTTP.

---

## Architectural Advice & Refactoring

**Add:** Read `resetToken` from router state (set by `code-verification`); inject `AuthService`; custom validator `passwordsMatch`; loading/error UI. **Correct:** Wire full chain or merge with `set-password` if single flow desired. **Remove:** Fake `setTimeout` success; use `submitted` in template or drop signal.

---

## Navigation Strategy

Next: `reset-password.component.html`, `code-verification.component_explanation.md`, `set-password.component.ts`, `auth.service_explanation.md`, backend `AuthController.resetPassword`.
