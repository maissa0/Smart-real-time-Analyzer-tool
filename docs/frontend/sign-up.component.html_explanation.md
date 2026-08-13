# `sign-up.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/sign-up/sign-up.component.html`

---

## Executive Summary

This template implements **two registration UI states**: the create-account form and a post-submit **pending admin approval** screen. It uses shared auth layout classes, inline validation messages, server error display, and links back to login.

**Business value:** Sets clear expectations that self-registration does not grant immediate access—aligns with backend `PENDING` user status.

---

## Architectural Process Orchestration

```
submitted() === false
        ▼
Form: name, email, password → (ngSubmit)="onSubmit()"
        ▼
errorMsg() / saving() reflected in template
        ▼
Success → submitted() === true
        ▼
Pending approval message + link to /auth/login
```

Template does not call HTTP directly—all via component.

---

## Key Controller/Service Capabilities

| UI state | Content |
|----------|---------|
| **Branding** | KPIT Analyser logo + platform subtitle |
| **Form** | Full name, email, password fields with touched validation errors |
| **Server error** | `@if (errorMsg())` centered red text |
| **Submit** | Disabled when invalid or `saving()`; label “Registering…” |
| **Footer** | `routerLink="/auth/login"` for existing users |
| **Success** | Hourglass emoji, orange “Registration Submitted”, pending copy, sign-in link |

Uses Angular `@if / @else` control flow.

---

## Critical Design Considerations

- **Mixed styling** — Tailwind-like utility classes plus inline `style=` for colors (consistent with other auth pages).
- **Success copy** — emphasizes admin approval and email notification (matches backend email intent).
- **No dashboard redirect** — unlike login success.

---

## Gotchas & Best Practices

- Success view does not show **backend response message** (only static text).
- No link to **forgot-password** or support contact on pending screen.
- Password field has no visibility toggle (login has one).
- Inline styles duplicate theme tokens—harder to theme globally.

---

## Architectural Advice & Refactoring

**Add:** Display `response.message` from register API; accessibility `for`/`id` on inputs. **Correct:** Extract repeated inline colors to auth SCSS. **Remove:** Nothing until API integration changes.

---

## Navigation Strategy

Next: `sign-up.component.ts`, `login.component.html` (sign-up link), `features/users/` pending approval UI.
