# `login.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/login/login.component.html`

---

## Executive Summary

This template is the **login screen UI**: optional social sign-in placeholders, email/password form with validation messages, password visibility toggle, “Keep me signed in”, forgot-password link, and sign-up link. It binds to `LoginComponent` signals and reactive form state.

**Business value:** Primary branded gate to the platform with accessible form feedback and loading state on submit.

---

## Architectural Process Orchestration

```
Template renders auth card
        ▼
User fills loginForm → (ngSubmit)="onSubmit()"
        ▼
Bindings: isLoading(), errorMessage(), passwordVisible(), loginForm validity
        ▼
Component handles HTTP + navigation (not in template)
        ▼
Links: /auth/forgot-password, /auth/register (RouterLink)
```

No direct service usage in HTML—all via component API.

---

## Key Controller/Service Capabilities

| UI section | Behavior |
|------------|----------|
| **Social buttons** | Facebook, Twitter, Google — static `type="button"`, **no actions** |
| **OR divider** | Visual separator before credential form |
| **Error alert** | `@if (errorMessage())` with `role="alert"` |
| **Email field** | Validation messages (required, email format), red border when touched+invalid |
| **Password field** | Show/hide toggle, `autocomplete="current-password"`, min-length message |
| **Keep me signed in** | Checkbox `keepSignedIn` — **not wired** in component logic |
| **Forgot password** | `routerLink="/auth/forgot-password"` |
| **Submit** | Disabled when invalid or `isLoading()`; spinner + “Signing in...” |
| **Sign up** | `routerLink="/auth/register"` |

Uses Angular control flow (`@if`, `@else if`).

---

## Critical Design Considerations

- **Shared auth design system** — `auth-page-bg`, `auth-card`, `auth-input`, `auth-btn-primary`, `auth-link`.
- **Accessibility** — password toggle has `aria-label` and `aria-pressed`; email/password have `id`/`for` labels.
- **Inline validation** — touched-state gating avoids errors on first paint.

---

## Gotchas & Best Practices

- **Misleading social login** — buttons look functional but do nothing—remove or implement to avoid user confusion.
- **Duplicate errors** — inline alert may appear together with toast from `errorInterceptor`.
- `keepSignedIn` checkbox sets user expectation without backend/session behavior change.
- Password error text says “min 1 character”—matches validator but weak security messaging vs policy.

---

## Architectural Advice & Refactoring

**Add:** Hide or disable social section until implemented; `returnUrl` hidden field if added to component. **Correct:** Wire `keepSignedIn` or remove checkbox. **Remove:** Decorative OAuth row if out of scope.

---

## Navigation Strategy

Next: `login.component.ts`, `forgot-password.component.html`, `sign-up/` templates, global auth SCSS.
