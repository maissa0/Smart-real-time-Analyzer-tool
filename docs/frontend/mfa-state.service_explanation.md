# `mfa-state.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/mfa-state.service.ts`

---

## Executive Summary

`MfaStateService` temporarily holds the **`mfaToken`** returned when login responds with HTTP 202 (MFA required). It bridges the gap between `AuthService.login` and `AuthService.mfaVerify` across route navigation to the MFA screen.

**Business value:** Avoids putting short-lived MFA tokens in URL query params or localStorage—keeps MFA step state in memory (signal) during the auth wizard.

---

## Architectural Process Orchestration

```
AuthService.login → 202 MfaAuthResponse
        ▼
LoginComponent → MfaStateService.setToken(mfaToken)
        ▼
Navigate to /auth/mfa-verify
        ▼
MfaVerifyComponent → getToken() → AuthService.mfaVerify
        ▼
Success → AuthStore.setAuth + MfaStateService.clear()
```

No backend CAN/Kafka coupling.

---

## Key Controller/Service Capabilities

| Method | Responsibility |
|--------|----------------|
| `mfaToken` | Readonly signal `string \| null` |
| `setToken(token)` | Store MFA JWT/challenge token |
| `clear()` | Reset after verify or abandon |
| `getToken()` | Imperative read (duplicate of signal) |

---

## Critical Design Considerations

- **In-memory only** — page refresh loses token (user must re-login)—acceptable security tradeoff.
- **Minimal surface** — intentionally tiny service.

---

## Gotchas & Best Practices

- Must **clear on logout** — verify `AuthStore.logout` or login flows call `clear()`.
- `getToken()` vs `mfaToken()` — redundant API; prefer signal only.

---

## Architectural Advice & Refactoring

**Add:** Optional sessionStorage backup with TTL if refresh during MFA is required. **Correct:** Ensure clear() on all exit paths. **Remove:** `getToken()` if signal suffices.

---

## Navigation Strategy

Next: `auth.service.ts`, `features/auth/mfa-verify/mfa-verify.component.ts`.
