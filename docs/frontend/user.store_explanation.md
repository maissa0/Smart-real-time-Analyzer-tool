# `user.store.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/store/user.store.ts`

---

## Executive Summary

`UserStore` manages **admin user-list state**: paginated users from the Java IAM API, filters, loading/error flags, and CRUD side-effects (status toggle, delete). It auto-loads users on store initialization via `withHooks({ onInit })`.

**Business value:** Powers the `/admin/users` management UI with reactive, paginated data aligned with Spring Boot `UserControllerV1` page responses.

---

## Architectural Process Orchestration

```
Angular UserListComponent (features/users/)
        │ reads signals: users(), isLoading(), pagination(), filter()
        │ dispatches: setFilter, setPage, deleteUserById, …
        ▼
UserStore (this file)
        │ inject(UserService)
        ▼
UserService.getUsers(filter, page, pageSize)
        │ GET /api/v1/users?…  (Bearer JWT from interceptor)
        ▼
Java UserControllerV1 + UserServiceV1
        │ JPA → MySQL users table
        ▼
PageResponse<UserResponse> → patchState(users, totalCount)
```

**No Kafka/Python:** Pure IAM admin vertical—orthogonal to CAN pipeline except shared JWT auth.

---

## Key Controller/Service Capabilities

| Method / computed | Responsibility |
|-------------------|----------------|
| `hasUsers` | Computed: `users().length > 0` |
| `totalPages` | Computed from `totalCount / pageSize` |
| `hasNextPage` / `hasPrevPage` | Pagination helpers |
| `loadUsers()` | Internal `fetchUsers()` — GET paginated list with current filter |
| `updateUser(updatedUser)` | Optimistic local replace by `id` (no server round-trip) |
| `patchStatus(userId, reason?)` | Calls `userService.toggleStatus`; reloads list on success |
| `deleteUserById(userId)` | DELETE user; reloads list |
| `setFilter(partial)` | Merge filter, reset page to 1, refetch |
| `setPage(page)` | Change page index, refetch |
| `setPageSize(pageSize)` | Change size, reset page 1, refetch |
| `setLoading` / `setError` | Manual state patches |
| `reset()` | Restore `initialState` |
| **`onInit` hook** | Calls `loadUsers()` immediately when store is first injected |

---

## Critical Design Considerations

- **Signal store + service injection in `withMethods`:** `inject(UserService)` inside factory—valid Angular DI pattern.
- **Refetch-on-mutation:** Delete/status change always re-fetches full page rather than splicing locally—simple consistency, extra network cost.
- **Filter reset on change:** `setFilter` resets to page 1—correct UX for search/status changes.
- **Eager init:** Any injection of `UserStore` anywhere triggers user list API call—even if user never opens admin users page.

---

## Gotchas & Best Practices

| Gotcha | Detail |
|--------|--------|
| **Eager `onInit` load** | Injecting `UserStore` on app startup (if ever imported globally) would hit `/api/v1/users` unnecessarily. Currently scoped to user admin feature—verify no accidental root injection. |
| **No request cancellation** | Rapid filter changes can return out-of-order responses; last-write-wins only by luck. |
| **Error typing** | `err: Error` may not match HttpErrorResponse shape—`err.message` often generic. |
| **`updateUser` local only** | Does not persist to server; caller must save via API separately. |

---

## Architectural Advice & Refactoring

### What to Add

- **`switchMap` + cancel prior requests** (RxJS) inside `fetchUsers` for filter debouncing.
- **Lazy load:** Remove `onInit` auto-fetch; let `UserListComponent` call `loadUsers()` in `ngOnInit`.
- **Selective store scope:** `providedIn: 'root'` → consider feature-level provider if list should not be global.

### What to Correct

- Parse `HttpErrorResponse` for backend `ApiError.message`.
- Guard admin-only routes before store init (non-admin shouldn't trigger user list).

### What to Get Rid Of

- Duplicate loading toggles if components also manage local spinners—pick one layer.

---

## Navigation Strategy

**Next files:**

1. `core/services/user.service.ts` — exact REST endpoints and query params.
2. `features/users/user-list/user-list.component.ts` — consumer of this store.
3. `backend/.../UserControllerV1.java` — server contract for pagination/filter.
4. `core/auth/admin.guard.ts` — ensures only admins reach user management.

---

## Source Reference

```typescript
withHooks({
  onInit(store) {
    store.loadUsers();
  },
})
```

```typescript
userService.getUsers(f, page, pageSize).subscribe({
  next: (pageRes) => patchState(store, {
    users: pageRes.content,
    pagination: { ...store.pagination(), totalCount: pageRes.totalElements },
  }),
});
```
