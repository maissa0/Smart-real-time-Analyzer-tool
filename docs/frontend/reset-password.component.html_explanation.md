# `reset-password.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/reset-password/reset-password.component.html`

---

## Executive Summary

This template renders the **new-password form** for the recovery wizard: two password fields, submit button, and back-to-login link. It uses shared auth styling and reactive form bindings; it does not show success, loading, or validation error states beyond HTML5/reactive disabled submit.

**Business value:** Consistent KPIT auth card UX for the last step of password reset—presentation only until backend integration is added.

---

## Architectural Process Orchestration

```
User lands on /auth/reset-password (from code-verification stub)
        ▼
Template: password + confirmPassword inputs
        ▼
(ngSubmit)="onSubmit()" when form valid
        ▼
Component fakes completion → redirect login (no template feedback)
```

Pure view layer—no services in HTML.

---

## Key Controller/Service Capabilities

| Element | Binding / behavior |
|---------|-------------------|
| Header | KPIT Analyser branding |
| Title | “Reset Password” |
| New password | `formControlName="password"`, `type="password"` |
| Confirm | `formControlName="confirmPassword"`, `type="password"` |
| Submit | `[disabled]="form.invalid"` — no loading spinner |
| Footer | `routerLink="/auth/login"` |

No `@if` blocks for errors, success, or `submitted()` signal.

---

## Critical Design Considerations

- **Minimal template** — no inline validation messages (user gets no “passwords must match” feedback).
- **Global auth classes** — `auth-page-bg`, `auth-card`, `auth-input`, `auth-btn-primary`, `auth-link`.
- **Accessibility** — labels present but no `for`/`id` pairing on inputs.

---

## Gotchas & Best Practices

- Submit enabled when both fields filled even if **passwords differ** (component lacks match validator).
- No indication that reset **failed or succeeded** before redirect.
- No password visibility toggle (unlike login screen).
- Users arriving without valid `resetToken` still see full form—misleading sense of security.

---

## Architectural Advice & Refactoring

**Add:** Mismatch error under confirm field; strength hint; success state before login redirect; `aria-describedby` for errors. **Correct:** Disable submit until passwords match. **Remove:** Nothing until API wired.

---

## Navigation Strategy

Next: `reset-password.component.ts`, `login.component.html`, `set-password` inline template for contrast (wired HTTP example).
