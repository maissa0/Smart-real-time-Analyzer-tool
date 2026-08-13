# `user-detail-panel.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/users/user-detail-panel/user-detail-panel.component.ts`

---

## Executive Summary

`UserDetailPanelComponent` is a **right-side slide-over panel** for deep user administration: read-only identity, editable job title/department (blur auto-save), role assignment, extra permission toggles, and recent audit log snippet. Uses `UserService` plus direct `HttpClient` for roles and audit logs.

**Business value:** Single surface for RBAC fine-tuning without leaving the user list—role inheritance vs extra permissions is visually distinguished.

---

## Architectural Process Orchestration

```
UserList opens panel [user]
        ▼
ngOnInit
  ├─ GET /api/v1/roles → role permission map
  ├─ userService.getUserPermissions(userId)
  ├─ GET /api/v1/audit-logs?userId=&size=5
  └─ effect syncs infoForm from user input
        ▼
saveInfo (blur) → userService.updateUser → saved output
saveRole → userService.assignRole → updateRolePerms → saved
savePermissions → userService.updateUserPermissions
closed → parent clears panel
```

---

## Key Controller/Service Capabilities

| Section | Behavior |
|---------|----------|
| `user` input | Required `User` |
| `closed` / `saved` outputs | Panel lifecycle + list refresh |
| Role select | `User` / `Admin` — `saveRole()` |
| Permissions grid | Role perms (lime, non-toggle) vs extra (blue, clickable) |
| `toggleExtraPerm()` | Skips role-inherited permissions |
| `permissionsChanged()` | Compares extra set to original |
| Audit | Last 5 logs for user |

Inline template (~200 lines) + scoped `styles` array (~170 lines)—self-contained component.

---

## Critical Design Considerations

- **Dual HTTP paths** — roles/audit via raw `HttpClient`; user mutations via `UserService` (auth interceptor applies to both if configured globally).
- **Role list hard-coded in UI** — only User/Admin options; `/api/v1/roles` used for permission IDs only.
- **Auto-save on blur** for job title/department—no explicit Save for info section.

---

## Gotchas & Best Practices

- `saved.emit(updated as unknown as User)` — type assertion suggests API shape mismatch.
- Permission load errors silent—grid stays on “Loading permissions…”.
- Audit track by `createdAt` may collide if same timestamp.
- Supersedes simpler `UserEditDrawerComponent` which is unused elsewhere.

---

## Architectural Advice & Refactoring

**Add:** Load role dropdown from API; use `AuditService` instead of raw HTTP. **Extract:** Template to `.html` for maintainability. **Remove:** Duplicate drawer if detail panel is canonical.

---

## Navigation Strategy

Next: `user.service_explanation.md`, `permission.guard_explanation.md`, backend `UserControllerV1` / `RoleControllerV1`.
