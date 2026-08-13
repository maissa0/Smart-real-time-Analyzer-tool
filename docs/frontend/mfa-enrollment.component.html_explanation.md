# `mfa-enrollment.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/settings/security-center/mfa-enrollment/mfa-enrollment.component.html`

---

## Executive Summary

This template renders the **MFA (TOTP) card**: enrolled success state with disable flow, or enrollment wizard (Enable button → QR/secret → 6-digit verify form).

**Business value:** Step-by-step TOTP setup UX matching Google Authenticator / Authy workflows.

---

## Architectural Process Orchestration

```
@if (isEnrolled()) → green banner + Disable MFA / password form
@else → description + @if (secret()) enrollment UI @else Enable button
        ▼
Forms: verificationForm (ngSubmit onSubmit), disableForm (disableMfa)
```

Binds to component signals and reactive forms.

---

## Key Controller/Service Capabilities

| State | UI |
|-------|-----|
| Enrolled | Success banner, Disable / Confirm Disable + Cancel |
| Not enrolled, no secret | “Enable MFA” button |
| Not enrolled, has secret | QR image or secret fallback, manual code, verify form |
| Invalid code | Red border + message via `isCodeInvalid()` |

Mixed inline styles + some Tailwind classes (`space-y-6`, `text-gray-700` labels).

---

## Critical Design Considerations

- **QR display** — `<img [src]="qrCodeUrl()">` when URL provided; else shows secret text.
- **6-digit input** — letter-spacing for OTP UX.
- **Password disable** — inline form in red-tinted panel.

---

## Gotchas & Best Practices

- Light-theme label classes (`text-gray-700`) on dark card—low contrast.
- Backup codes never shown—only toast from TS.
- `cancelEnrollment` button visible during setup—clears local state only.
- No loading state on Verify submit beyond form validity disable.

---

## Architectural Advice & Refactoring

**Add:** Backup codes display; dark-theme labels; submitting spinner on verify. **Correct:** Theme consistency. **Remove:** Nothing.

---

## Navigation Strategy

Next: `mfa-enrollment.component.ts`, `auth.store_explanation.md`.
