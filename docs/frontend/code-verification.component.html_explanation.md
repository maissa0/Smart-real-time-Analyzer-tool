# `code-verification.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/code-verification/code-verification.component.html`

---

## Executive Summary

This template is the **view layer** for the OTP verification screen: branded auth card, four single-digit inputs, primary Verify button, and a Resend placeholder link. It binds to `CodeVerificationComponent` signals and event handlers; styling relies on global auth utility classes (`auth-page-bg`, `auth-card`, `auth-input`, `auth-btn-primary`).

**Business value:** Consistent KPIT auth visual language and accessible numeric OTP entry (large touch targets, `inputmode="numeric"`).

---

## Architectural Process Orchestration

```
CodeVerificationComponent (class)
        ▼
Template bindings: digits(), onDigitInput, onPaste, onSubmit, verifying()
        ▼
User interaction → component signals update → button enable/disable
        ▼
(onSubmit) component navigates away — template does not call HTTP
```

No direct service injection in HTML—pure presentation bound to component API.

---

## Key Controller/Service Capabilities

| UI block | Binding / behavior |
|----------|-------------------|
| Header | Static “KPIT Analyser” branding (`#b0ff44` accent) |
| Title / copy | “Code Verification”, 4-digit email instruction |
| Digit row | `@for (d of digits(); track $index)` — 4 inputs `#digitInput` |
| Paste | Container `(paste)="onPaste($event)"` |
| Each input | `[value]="d"`, `(input)`, `(keydown)`, `maxlength="1"` |
| Verify button | `(click)="onSubmit()"`, disabled if code incomplete or `verifying()` |
| Footer | “Resend” `<a href="#">` — **not wired** |

Button shows “Verifying...” when `verifying()` is true.

---

## Critical Design Considerations

- **External template** — separated from `.ts` for readability (unlike inline auth siblings).
- **Global CSS classes** — assumes auth layout styles loaded app-wide (likely `styles.scss` or auth layout).
- **Inline styles** — some colors on headings/paragraphs instead of Tailwind/theme tokens only.
- **Accessibility** — numeric inputs but no `aria-label` per digit; paste handler on wrapper div.

---

## Gotchas & Best Practices

- **Resend link** — `href="#"` prevents navigation but does nothing; should be `(click)` + preventDefault or `RouterLink`.
- **No `RouterLink` back to login** — unlike other auth templates.
- `[value]` one-way binding with manual `(input)` — correct for signal updates; avoid adding `ngModel` without two-way sync.
- Verify button is `type="button"` — good (not accidental form submit).

---

## Architectural Advice & Refactoring

**Add:** Error message block; disabled Resend with countdown; `aria-label="Digit {{ n }} of 4"`. **Correct:** Wire Resend to component method. **Remove:** Dead `href="#"` or replace with button.

---

## Navigation Strategy

Next: `code-verification.component.ts`, shared auth SCSS/classes, `forgot-password.component.html` for flow continuity.
