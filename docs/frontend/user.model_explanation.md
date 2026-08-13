# `user.model.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/models/user.model.ts`

---

## Executive Summary

`user.model.ts` defines the central **`User` interface**—the IAM user profile DTO used after login, in admin user management, and in profile settings. It aggregates identity fields, MFA/active flags, optional `Role[]`, and optional `Permission[]`.

**Business value:** Single user shape for auth state (`AuthStore`), admin CRUD (`UserStore`/`UserService`), and self-service profile flows.

---

## Architectural Process Orchestration

```
Java UserEntity → UserResponse DTO (camelCase)
        ▼
AuthResponse.user | GET /api/v1/users | GET /profile/me
        ▼
User interface
        ▼
AuthStore.user / UserStore.users / user-list, user-edit-drawer, profile UI
```

Integration Guide section 3.1.

---

## Key Controller/Service Capabilities

| Field group | Fields | Notes |
|-------------|--------|-------|
| Identity | `id`, `email`, `username`, `fullName` | `username` may mirror email |
| Org profile | `jobTitle`, `department`, `phone`, `avatarUrl` | Settings UI |
| Flags | `isActive`, `mfaEnabled`, `verified`, `status?` | `status`: PENDING, ACTIVE, REJECTED, etc. |
| RBAC | `roles?`, `permissions?` | Nested `Role` / `Permission` |
| Audit | `createdAt` | ISO string |

Circular type graph: `User` → `Role` → `Permission`; `User.permissions` uses inline import type.

---

## Critical Design Considerations

- **Optional RBAC arrays** — not every endpoint embeds roles/permissions.
- **`fullName` nullable** — templates should fallback to `username` or `email`.
- **Status vs isActive** — two overlapping concepts; moderation uses `status`.

---

## Gotchas & Best Practices

- After avatar upload, **`avatarUrl` may need cache bust** in profile UI.
- `AuthStore` and `UserStore` both hold `User`—can drift after admin edits unless refreshed.
- Pending users (`status: PENDING`) flow through `getPendingUsers` / approve / reject.

---

## Architectural Advice & Refactoring

**Add:** Shared `UserSummary` type for list rows vs full detail. **Correct:** Refresh `AuthStore.user` after profile update. **Remove:** Redundant `permissions` on user if always derived from roles server-side.

---

## Navigation Strategy

Next: `auth.model_explanation.md`, `store/user.store_explanation.md`, `features/users/user-list/`, backend `UserResponse.java`.
