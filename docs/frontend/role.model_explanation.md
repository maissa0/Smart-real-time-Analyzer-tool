# `role.model.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/models/role.model.ts`

---

## Executive Summary

`role.model.ts` defines the **`Role` interface** for RBAC grouping: named roles (Admin, Operator, etc.) with optional nested `Permission[]`. Roles attach to `User.roles` from backend user/admin APIs.

**Business value:** Coarse-grained access tiers displayed in user admin UI and carried on user DTOs; complements slug-level `Permission` checks.

---

## Architectural Process Orchestration

```
MySQL roles + role_permissions (Java)
        ▼
UserResponse / Auth user object
        ▼
Role { id, name, description, permissions? }
        ▼
User.roles on UserStore / user-list / user-edit-drawer
        ▼
UserService.assignRole(id, roleName) for admin updates
```

Integration Guide section 3.2.

---

## Key Controller/Service Capabilities

| Field | Type | Role |
|-------|------|------|
| `id` | `string` | Role UUID |
| `name` | `string` | Display + assignRole target (e.g. `"ADMIN"`) |
| `description` | `string \| null` | Admin UI copy |
| `permissions` | `Permission[]?` | Optional expanded permission list |

Imports `Permission` type only (type-only dependency).

---

## Critical Design Considerations

- **Role vs permission** — guards may check role name (`adminGuard`) or permission slug (`hasPermission`); two parallel RBAC layers.
- **Optional `permissions`** — list endpoints may omit expansion for payload size.

---

## Gotchas & Best Practices

- `assignRole` uses **role name string**, not `Role.id`—must match backend enum/name.
- User may have **multiple roles** (`roles?` array) but UI often shows primary only.
- Do not confuse with Angular **Route roles**—this is domain IAM model.

---

## Architectural Advice & Refactoring

**Add:** Normalize to single effective role if backend enforces one role per user. **Correct:** Always fetch expanded permissions when rendering permission matrix. **Remove:** Nothing.

---

## Navigation Strategy

Next: `user.model_explanation.md`, `admin.guard_explanation.md`, backend `RoleResponse.java`.
