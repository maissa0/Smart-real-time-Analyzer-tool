# `code-verification.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/code-verification/code-verification.component.ts`

---

## Executive Summary

`CodeVerificationComponent` is the **OTP entry step** in the password-recovery wizard at `/auth/verify-code`. It renders a 4-digit PIN-style input with auto-advance, backspace navigation, and paste support. On submit it **does not call the backend**—it simulates verification with a 500ms delay and navigates to `/auth/reset-password`.

**Business value:** UX placeholder for email OTP validation between forgot-password and reset-password; intended to wire to `AuthService.verifyOtp(email, code)` per Integration Guide.

---

## Architectural Process Orchestration

```
(Intended flow — not fully wired)
ForgotPasswordComponent → POST /api/auth/forgot-password
        ▼
Navigate to /auth/verify-code  (email should be carried in state/query)
        ▼
CodeVerificationComponent — collect 4-digit code
        ▼
(Should) AuthService.verifyOtp(email, code) → { resetToken, expiresInSeconds }
        ▼
Navigate to /auth/reset-password with resetToken
        ▼
ResetPasswordComponent → POST /api/auth/reset-password

(Current implementation)
onSubmit() → setTimeout 500ms → router.navigateByUrl('/auth/reset-password')
(no AuthService, no email, no resetToken)
```

Public route under `/auth/*` — no `authGuard`.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `digits` | Signal `string[4]` — one character per box |
| `verifying` | Loading flag during fake submit |
| `onDigitInput` | Numeric-only, auto-focus next field |
| `onDigitKeydown` | Backspace moves to previous empty box |
| `onPaste` | Distributes up to 4 digits from clipboard |
| `getCode()` | Joins digits into OTP string |
| `onSubmit()` | Requires length 4; navigates to reset-password |
| `ngAfterViewInit` | Focuses first input |

**Not used:** `AuthService`, `RouterLink`, route query params, session/local storage for email or token.

---

## Critical Design Considerations

- **Standalone + OnPush** — signal-driven; template in external HTML file.
- **FormsModule** imported but template uses native inputs + `(input)` handlers, not `ngModel`.
- **RouterLink** not imported — template “Resend” uses `href="#"` (dead link).
- **4-digit code** — must match backend OTP length contract when integrated.

---

## Gotchas & Best Practices

- **Incomplete auth spine** — `forgot-password` and `reset-password` siblings also skip `AuthService`; full recovery chain is UI-only.
- Submit succeeds without validating code against server—**security gap** until wired.
- No error state, no resend handler, no email context—user cannot complete real reset.
- `RouterLink` missing though other auth pages use it for “back to login”.
- Compare with **`MfaVerifyComponent`** (`/auth/mfa-verify`) which does call auth APIs for login MFA.

---

## Architectural Advice & Refactoring

**Add:** Inject `AuthService`; pass `email` via `Router` state or query param from forgot-password; call `verifyOtp`; store `resetToken` (service or router state); handle 422/401 errors. **Correct:** Implement Resend → `forgotPassword(email)` again. **Remove:** Fake `setTimeout` navigation.

---

## Navigation Strategy

Next: `code-verification.component.html`, `forgot-password.component.ts`, `reset-password.component.ts`, `auth.service_explanation.md`, backend `AuthController` OTP endpoints.
