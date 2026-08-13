# `forgot-password.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/forgot-password/forgot-password.component.html`

---

## Executive Summary

This template implements the **two-state forgot-password UI**: an email capture form and a post-submit “Check Your Mail” confirmation. It uses shared auth layout classes and `@if (submitted())` to switch views without route changes.

**Business value:** Branded recovery entry consistent with other auth screens; clear CTA back to login after (simulated) submit.

---

## Architectural Process Orchestration

```
submitted() === false
        ▼
Form [formGroup]="form" (ngSubmit)="onSubmit()"
        ▼
User enters email → Send Reset Link
        ▼
Component sets submitted(true)
        ▼
submitted() === true → success panel (icon, message, Back to Login)
```

Template does not perform HTTP or route to verify-code—purely reflects `submitted` signal.

---

## Key Controller/Service Capabilities

| UI state | Elements | Bindings |
|----------|----------|----------|
| **Form** | Title, email input, submit | `formControlName="email"`, `[disabled]="form.invalid"` |
| **Success** | Mail icon, heading, body copy | Shown when `submitted()` |
| **Navigation** | `routerLink="/auth/login"` | Form footer link + success button |

Uses `@if / @else` control flow (Angular 17+).

---

## Critical Design Considerations

- **Global auth styling** — `auth-page-bg`, `auth-card`, `auth-input`, `auth-btn-primary`, `auth-link`.
- **Inline brand colors** — `#b0ff44` KPIT accent on logo.
- **Success without proof** — confirmation appears even if backend never called (component behavior).

---

## Gotchas & Best Practices

- Copy says **“password recovery link”** — product uses **OTP code** flow; misleading for users and auditors.
- No link to **`/auth/verify-code`** after submit—recovery chain breaks in UI.
- Email field has label but no `aria-invalid` / error messages for invalid submit attempts.
- Submit button disabled when `form.invalid`—good; no explicit loading state on button.

---

## Architectural Advice & Refactoring

**Add:** `@else` error banner; “Enter code” button → `routerLink="/auth/verify-code"` with email state; loading text on submit. **Correct:** OTP-oriented messaging. **Remove:** Misleading “reset link” wording unless backend switches to magic links.

---

## Navigation Strategy

Next: `forgot-password.component.ts`, `login.component.html` (forgot link), `code-verification/` folder docs.
