# `mfa-enrollment.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/settings/security-center/mfa-enrollment/mfa-enrollment.component.ts`

---

## Executive Summary

`MfaEnrollmentComponent` implements **profile MFA enrollment and disable**: enable TOTP (QR + secret + 6-digit confirm), update `AuthStore.mfaEnabled`, and disable with password confirmation. Uses `ProfileService.mfaEnable`, `mfaConfirm`, `mfaDisable`.

**Business value:** Account hardening separate from login-time MFA verify (`MfaVerifyComponent`)—users enable TOTP from settings after login.

---

## Architectural Process Orchestration

```
ngOnInit → isEnrolled from authStore.user().mfaEnabled
        ▼
Enable flow:
  startEnrollment() → POST mfa/enable → secret + qrCodeUrl
        ▼
  onSubmit() → mfaConfirm(code) → backupCodes toast
        ▼
  authStore.updateUser({ mfaEnabled: true })

Disable flow:
  showDisableForm → disableMfa(password) → POST mfa/disable
        ▼
  authStore.updateUser({ mfaEnabled: false })
```

Distinct from login MFA: uses **profile** endpoints, not `AuthService.mfaVerify`.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `isEnrolled` | Local signal; synced from store on init |
| `secret`, `qrCodeUrl` | Enrollment setup response |
| `verificationForm` | 6-digit TOTP pattern |
| `disableForm` | Password required to disable |
| `startEnrollment`, `onSubmit`, `disableMfa` | API orchestration |
| `cancelEnrollment`, `cancelDisable` | Reset UI state |

---

## Critical Design Considerations

- **Two forms** — verification (enable) and disable (password).
- **Backup codes** — toast info only; not displayed in UI for user to copy.
- **Store sync** — patches `mfaEnabled` locally after success; does not re-fetch full user.

---

## Gotchas & Best Practices

- **`isEnrolled` init only** — if user enabled MFA elsewhere, stale until page reload.
- `startEnrollment` sets `isEnrolling` true then false on response—brief flicker on Enable button.
- Cancel enrollment clears secret but does not call backend to abort pending enrollment.
- Login MFA (`/auth/mfa-verify`) vs settings MFA—document both paths for operators.

---

## Architectural Advice & Refactoring

**Add:** Display backup codes modal; refresh user from `getMe()` after enroll. **Correct:** Show enrollment errors via toast. **Remove:** Nothing.

---

## Navigation Strategy

Next: `mfa-enrollment.component.html`, `mfa-verify.component_explanation.md`, `profile.service.ts`, backend MFA profile endpoints.
