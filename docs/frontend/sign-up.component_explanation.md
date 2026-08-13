# `sign-up.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/sign-up/sign-up.component.ts`

---

## Executive Summary

`SignUpComponent` is the **self-service registration** screen at `/auth/register`. It collects name, email, and password, POSTs to `/api/auth/register`, and on success shows a **pending approval** state—matching backend behavior where new users get `status: PENDING` and `isActive: false` without immediate JWT login.

**Business value:** Allows operators to request platform access; admin approves via user management before login succeeds.

---

## Architectural Process Orchestration

```
Login “Sign up” link → /auth/register
        ▼
SignUpComponent form (name, email, password)
        ▼
POST /api/auth/register { name, email, password }  (public)
        ▼
AuthService.register (Java) → UserEntity PENDING, isActive=false
        ▼
Audit + sendRegistrationPendingEmail
        ▼
Response AuthResponse (message only — no tokens)
        ▼
Frontend: submitted.set(true) — pending UI (no AuthStore)
        ▼
User waits admin approve → set-password invite or activation → /auth/login
```

Uses **raw `HttpClient`**, not `AuthService.register()` (which exists and types `AuthResponse`).

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `form` | `name`, `email`, `password` (min 8) — matches `RegisterRequest` |
| `saving` | Loading during POST |
| `errorMsg` | Server/validation error message |
| `submitted` | Switches template to pending-approval view |
| `onSubmit()` | Validates, POST register, handles next/error |

**Not used:** `AuthStore`, `Router` (navigation via template `RouterLink` only).

---

## Critical Design Considerations

- **No auto-login on register** — correct for PENDING workflow; unlike login/MFA success paths.
- **Standalone + OnPush** — signals + reactive forms; external HTML template.
- **Response ignored** — backend `message` in body not displayed; static copy in template suffices.
- **Field name `name`** — maps to backend `RegisterRequest.name` → `UserEntity.fullName`.

---

## Gotchas & Best Practices

- **`errorInterceptor`** may toast **and** inline `errorMsg` on failure (duplicate UX).
- Duplicate email → backend `IllegalArgumentException` → generic error message.
- No confirm-password field (unlike set-password).
- `AuthService.register` available but bypassed—same pattern as set-password vs service layer.
- Approved users may receive **set-password email** (invite flow)—self-register already set password in form.

---

## Architectural Advice & Refactoring

**Add:** Use `AuthService.register`; show backend `message` in success UI; optional confirm password. **Correct:** Consolidate HTTP auth calls in `AuthService`. **Remove:** Nothing critical.

---

## Navigation Strategy

Next: `sign-up.component.html`, `login.component.html`, `auth.service_explanation.md`, backend `AuthService.register`, admin `approveUser` flow.
