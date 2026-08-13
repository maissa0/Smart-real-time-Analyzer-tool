# `forgot-password.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/forgot-password/forgot-password.component.ts`

---

## Executive Summary

`ForgotPasswordComponent` is the **first step of password recovery** at `/auth/forgot-password`. It collects the user's email via a reactive form and, on valid submit, flips a `submitted` signal to show a success state—**without calling `AuthService.forgotPassword()` or navigating to OTP verification**.

**Business value:** Entry point linked from login (“Forgot Password?”); intended to trigger backend OTP email (`POST /api/auth/forgot-password`) before `/auth/verify-code`.

---

## Architectural Process Orchestration

```
LoginComponent → routerLink /auth/forgot-password
        ▼
ForgotPasswordComponent — email form
        ▼
(Intended) AuthService.forgotPassword(email)
        ▼ POST /api/auth/forgot-password (public, rate-limited)
Backend AuthService → OtpService → EmailService (4-digit OTP)
        ▼
Navigate to /auth/verify-code with email in router state

(Current implementation)
onSubmit() → if form.valid → submitted.set(true)
        ▼
Template shows “Check Your Mail” (no HTTP, no navigation to verify-code)
```

Route is public under `/auth/*`; endpoint listed in `app.config.ts` `PUBLIC_AUTH_PATHS`.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `form` | `FormBuilder` group: `email` (required, email validator) |
| `submitted` | Boolean signal — toggles form vs success UI in template |
| `onSubmit()` | Validates form; sets `submitted` true only |

**Not used:** `AuthService`, `Router`, loading/error signals, navigation to verify-code.

---

## Critical Design Considerations

- **Standalone + OnPush** — minimal state; template-driven success branch.
- **Reactive forms** — `nonNullable` group with `ReactiveFormsModule`.
- **Single responsibility (intended)** — request OTP only; verification is `CodeVerificationComponent`.

---

## Gotchas & Best Practices

- **Copy mismatch** — template says “reset link”; backend sends **4-digit OTP** (see `OtpService`, `verify-code` route).
- Success UI offers **“Back to Login”** only—skips `/auth/verify-code` entirely.
- No loading spinner, error toast, or rate-limit (429) handling—`errorInterceptor` never invoked if no HTTP.
- `AuthService.forgotPassword(email)` already exists and is tested on backend—frontend integration gap.
- Compare **`LoginComponent`** / **`MfaVerifyComponent`** for wired auth patterns.

---

## Architectural Advice & Refactoring

**Add:** Inject `AuthService` + `Router`; on success navigate to `/auth/verify-code` with `{ state: { email } }`; `loading`/`error` signals. **Correct:** Align copy with OTP flow (“Check your email for a 4-digit code”). **Remove:** Premature success without API confirmation (avoid email enumeration UX leaks—backend may always return 200).

---

## Navigation Strategy

Next: `forgot-password.component.html`, `code-verification.component_explanation.md`, `auth.service_explanation.md`, backend `AuthController.forgotPassword`.
