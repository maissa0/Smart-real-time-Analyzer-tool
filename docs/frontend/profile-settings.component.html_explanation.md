# `profile-settings.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/profile/profile-settings/profile-settings.component.html`

---

## Executive Summary

This template implements the **Profile & Account** layout: breadcrumb, left identity sidebar (avatar, role, status, MFA, member since), horizontal tab bar, and tab-specific content inside a shared card bound to one reactive `formGroup`.

**Business value:** KPIT-themed self-service UX consolidating profile editing, password change, placeholder preferences, audit log, and security center in one screen.

---

## Architectural Process Orchestration

```
Component signals (activeTab, authStore, form, loading flags)
        ▼
Template sections:
  app-breadcrumb
  Sidebar ← authStore.user()
  Tab buttons → setTab()
  @if activeTab → profile | password | settings | audit | security content
        ▼
User actions → component methods → ProfileService
```

Embedded components handle their own HTTP when audit/security tabs active.

---

## Key Controller/Service Capabilities

| Section | Content |
|---------|---------|
| **Breadcrumb** | `app-breadcrumb` (fed by `BreadcrumbService` in TS) |
| **Sidebar avatar** | Image / initial; file input overlay → `onAvatarSelected` |
| **Sidebar meta** | email, role badge, active, MFA, createdAt |
| **Tabs** | 5 buttons driven by `tabs` array |
| **Profile tab** | Editable fullName, phone; read-only email, username, job, dept, role, member since |
| **Password tab** | current / new / confirm fields → `changePassword` |
| **Settings tab** | Email notifications toggle (static checked); language select (English only) |
| **Audit tab** | `<app-audit-log [embedded]="true" />` |
| **Security tab** | `<app-security-center [embedded]="true" />` |

Heavy inline styles; dark theme `#07090b` / `#b0ff44`.

---

## Critical Design Considerations

- **Single `[formGroup]="form"`** on tab card wraps profile and password controls.
- **Read-only fields** — rendered as `<p>` blocks, not disabled inputs.
- **DatePipe** — `createdAt` formatted in sidebar and profile tab.
- **Embedded mode** — audit/security components likely hide outer chrome when `embedded=true`.

---

## Gotchas & Best Practices

- **Settings tab is decorative** — checkbox always `checked`; no `(change)` or persistence.
- **Confirm password** — enabled in button `[disabled]` but mismatch not shown in UI.
- Avatar `[src]` may need cache-bust if same URL after re-upload (backend-dependent).
- Long profile on small screens — fixed 240px sidebar may need responsive collapse (not implemented).
- Language `<select>` has single option—placeholder for i18n.

---

## Architectural Advice & Refactoring

**Add:** Wire settings toggles to user preferences API; password mismatch error; responsive layout. **Correct:** Extract repeated input styles to SCSS. **Remove:** Dead settings UI or implement backend.

---

## Navigation Strategy

Next: `profile-settings.component.ts`, `settings/audit-log/`, `settings/security-center/`, `navbar.component.html` profile link.
