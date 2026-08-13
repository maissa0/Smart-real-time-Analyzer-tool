# `user.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/user.service.ts`

---

## Executive Summary

`UserService` is the **REST client for admin user management** (`/api/v1/users/*`): paginated listing, CRUD-ish updates, invite/approve/reject, role assignment, permissions, and password patches. It feeds `UserStore` and user admin UI components.

**Business value:** Enables fleet/IAM admins to manage platform users separately from CAN session data.

---

## Architectural Process Orchestration

```
UserListComponent / UserEditDrawer / UserDetailPanel
        ▼
UserStore (optional) → UserService
        ▼
GET/POST/PUT/PATCH/DELETE /api/v1/users/...
        ▼
UserControllerV1 + UserServiceV1 (Java) → MySQL users, roles, permissions
```

Protected by JWT + backend admin checks; frontend uses `adminGuard` on user routes.

---

## Key Controller/Service Capabilities

| Method | HTTP | Purpose |
|--------|------|---------|
| `getUsers(filter, page, pageSize)` | GET `/` | Paginated list with search/status/sort |
| `getUser(id)` | GET `/{id}` | Single user |
| `updateUser(id, body)` | PUT `/{id}` | Profile fields |
| `patchPassword(id, …)` | PATCH `/{id}/password` | Admin/user password change |
| `inviteUser(body)` | POST `/invite` | Invite flow |
| `deleteUser(id)` | DELETE `/{id}` | Remove user |
| `toggleStatus(id, reason?)` | PATCH `/{id}/status` | Enable/disable |
| `getPendingUsers()` | GET `/pending` | Approval queue |
| `approveUser` / `rejectUser` | POST | Moderation |
| `assignRole(id, roleName)` | PATCH `/{id}/role` | RBAC |
| `getUserAuditLogs(userId)` | GET `/api/v1/audit-logs?...` | **Hack:** string replace on base URL |
| `getUserPermissions` / `updateUserPermissions` | GET/PUT `/{id}/permissions` | Fine-grained RBAC |

---

## Critical Design Considerations

- **1-based page in API calls** — `safePage = Math.max(1, page)` matches backend convention.
- **Filter object** — `UserFilterCriteria` from `data/types/filter.types.ts`.
- **No local state** — unlike `UserStore`, this is pure HTTP.

---

## Gotchas & Best Practices

- **`getUserAuditLogs`** — fragile `base.replace('/users', '')` — should use `AuditService`.
- **`any` return types** on permissions/audit — weak typing.
- Page index confusion between store (may use 0 vs 1) — verify alignment.

---

## Architectural Advice & Refactoring

**Add:** Strong DTOs for permissions. **Correct:** Delegate audit logs to `AuditService`. **Remove:** String-replace URL hack.

---

## Navigation Strategy

Next: `store/user.store.ts`, `features/users/user-list/user-list.component.ts`, backend `UserControllerV1.java`.
