# `user-list.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/users/user-list/user-list.component.ts`

---

## Executive Summary

`UserListComponent` is the **admin user management hub**: paginated user table via `UserStore`, pending registration approvals, invite flow, activate/deactivate/delete modals, and slide-over detail panel. It orchestrates `UserService`, `AuthService`, and `UserStore` with debounced search.

**Business value:** Central RBAC operations—invite colleagues, approve self-registrations, toggle account status, open per-user role/permission editor.

---

## Architectural Process Orchestration

```
ngOnInit
  ├─ BreadcrumbService: Home → Users → List
  ├─ userStore.loadUsers() (force refresh on each mount)
  ├─ debounced search → userStore.setFilter({ search })
  └─ getPendingUsers() → pendingUsers signal
        ▼
Table row click → openDetailPanel → UserDetailPanelComponent
Invite → userService.inviteUser → reload list
Approve/Reject → userService → refresh pending + list
Status badge → patchStatus / onActivate via UserStore
Delete → userStore.deleteUserById
Detail saved → userStore.updateUser
```

---

## Key Controller/Service Capabilities

| Area | Methods / state |
|------|-----------------|
| Data | `userStore`, `filteredUsers` (mirrors store list; server-side filter) |
| Search | `searchInput$` (300ms debounce), `clearSearch()` |
| Invite | `inviteForm`, `submitInvite()`, `openInviteModal()` |
| Lifecycle | `confirmDeactivate()`, `onActivate()`, `confirmDelete()` |
| Pending | `pendingUsers`, `approveUser()`, `confirmReject()` |
| Detail | `showDetailPanel`, `detailPanelUser`, `onUserRoleUpdated()` |
| Helpers | `formatRole()` — strips `ROLE_`, title-cases |

**Unused in template:** `onResetPassword()` (calls `authService.forgotPassword`)—dead code path.

---

## Critical Design Considerations

- **Store reload on mount** — comment notes `UserStore.onInit` only runs once globally; component forces `loadUsers()` each visit.
- **Pending users** — separate local signal, not in `UserStore`.
- **OnPush + signals** — modals driven by boolean signals; forms use ReactiveFormsModule.
- **Deactivate requires reason** — passed to `userStore.patchStatus(userId, reason)`.

---

## Gotchas & Best Practices

- `filteredUsers` name implies client filter but filtering is **server-side** via store.
- Duplicate breadcrumb: component sets `BreadcrumbService` while template also renders inline nav.
- Invite role options (`User` / `Admin`) are hard-coded strings—not loaded from `/api/v1/roles`.
- Error on pending fetch is swallowed (`error: () => {}`).

---

## Architectural Advice & Refactoring

**Add:** Wire reset-password action or remove `onResetPassword`. **Move:** Pending users into `UserStore`. **Replace:** Inline HTML breadcrumb with shared breadcrumb component. **Remove or wire:** `UserEditDrawerComponent` (superseded by detail panel).

---

## Navigation Strategy

Next: `user-list.component.html`, `user.store_explanation.md`, `user.service_explanation.md`, `user-detail-panel.component_explanation.md`.
