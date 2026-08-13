# `permission.model.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/models/permission.model.ts`

---

## Executive Summary

`permission.model.ts` defines the **`Permission` interface**—the atomic RBAC unit (slug + description) used in auth responses, user records, roles, and the `has-permission` directive.

**Business value:** Fine-grained access control labels (e.g. `can:read`, `users:manage`) shared across login payload, stores, and template guards.

---

## Architectural Process Orchestration

```
MySQL permissions + role_permissions (Java)
        ▼
AuthResponse.permissions + User.permissions + Role.permissions
        ▼
Permission { id, slug, description }
        ▼
AuthStore.permissions signal
        ▼
hasPermission directive / permissionGuard (if wired)
        ▼
UI show/hide admin actions
```

Integration Guide section 3.3.

---

## Key Controller/Service Capabilities

| Field | Type | Role |
|-------|------|------|
| `id` | `string` | UUID primary key |
| `slug` | `string` | Machine-readable key checked in guards/directives |
| `description` | `string \| null` | Human label in admin UI |

Interface only—no enums or helper functions.

---

## Critical Design Considerations

- **Slug is the runtime check key** — not `id` or `description`.
- **Optional nesting** — may appear on `User`, `Role`, and top-level `AuthResponse`.
- **Backend is source of truth** — frontend does not define valid slug list.

---

## Gotchas & Best Practices

- `AuthStore.hasPermission(slug)` must match backend slug strings exactly.
- `permissionGuard` defined but **may be unused in routes**—permissions still used in templates.
- Admin permission edit via `UserService.getUserPermissions` may return looser typing (`any`).

---

## Architectural Advice & Refactoring

**Add:** Const enum or union of known slugs for compile-time checks (if catalog is stable). **Correct:** Strongly type permission API responses. **Remove:** Duplicate permission arrays if user and auth response diverge.

---

## Navigation Strategy

Next: `role.model_explanation.md`, `has-permission.directive_explanation.md`, backend `PermissionResponse.java`.
