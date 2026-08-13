# `profile-settings.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/profile/profile-settings/profile-settings.component.ts`

---

## Executive Summary

`ProfileSettingsComponent` is the **unified profile hub** at `/admin/profile`: sidebar identity card, five tabs (profile, password, settings, audit, security), and orchestration of `ProfileService`, `AuthStore`, breadcrumbs, toasts, and embedded settings sub-features.

**Business value:** Self-service account management for logged-in operators—profile fields, avatar, password change, personal audit trail, and MFA/sessions via reused settings components.

---

## Architectural Process Orchestration

```
Navbar → /admin/profile
        ▼
ngOnInit: BreadcrumbService.set + profileService.getMe()
        ▼
AuthStore.updateUser (hydrate from API)
        ▼
Tab actions:
  profile  → updateMe({ fullName, phone }) + uploadAvatar
  password → changePassword(current, new)
  settings → (UI only in template)
  audit    → <app-audit-log [embedded]="true">
  security → <app-security-center [embedded]="true">
        ▼
ProfileControllerV1 /api/v1/profile/me
```

Uses **`authInterceptor`** for HTTP (no manual Bearer in component).

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `activeTab` | `'profile' \| 'password' \| 'settings' \| 'audit' \| 'security'` |
| `form` | Single group: profile fields + password fields |
| `saveProfile()` | PUT profile; toast success; `authStore.updateUser` |
| `onAvatarSelected()` | FileReader preview + POST avatar |
| `changePassword()` | PATCH password (no confirm match check in TS) |
| `setTab()` | Updates tab + breadcrumb trail |
| `primaryRole()` | First role name from `authStore.user()` |
| `loadProfile()` | `getMe()` on init |

**Injected:** `AuthStore`, `ProfileService`, `BreadcrumbService`, `ToastService`, `FormBuilder`.

**Child imports:** `AuditLogComponent`, `SecurityCenterComponent`, `BreadcrumbComponent`.

---

## Critical Design Considerations

- **Monolithic tab host** — one form wraps all tabs (password fields persist when switching tabs).
- **AuthStore as read source** — sidebar reads `authStore.user()`; refreshed after API updates.
- **Embedded settings features** — reuses `features/settings/` with `[embedded]="true"`.
- **OnPush + signals** — loading flags per action.

---

## Gotchas & Best Practices

- **`changePassword`** — template requires confirm filled but **no validator** that confirm equals new password.
- **`loadProfile` error** — empty error handler; relies on stale `AuthStore` from login.
- **Settings tab** — not wired to backend (see HTML doc).
- **`primaryRole()`** — only first role; multi-role users underrepresented.
- ProfileService also has MFA/session methods—used by `SecurityCenterComponent`, not this TS file directly.

---

## Architectural Advice & Refactoring

**Add:** Password match validator; split forms per tab; sync tab to URL. **Correct:** Handle `getMe` failure with toast. **Remove:** Duplicate settings routes if profile becomes sole entry.

---

## Navigation Strategy

Next: `profile-settings.component.html`, `profile.service_explanation.md`, `audit-log.component`, `security-center.component`, `auth.store_explanation.md`.
