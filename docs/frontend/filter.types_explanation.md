# `filter.types.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/types/filter.types.ts`

---

## Executive Summary

`filter.types.ts` defines **client-side list UI state types** for the admin user directory: search/status/sort filter criteria (`UserFilterCriteria`), status enum (`UserStatusFilter`), and local pagination snapshot (`PaginationState`). These are not backend DTOs—they describe what `UserStore` holds before mapping to HTTP query params.

**Business value:** Separates “what the user list UI is filtering” from domain models (`User`) and API envelopes (`PageResponse`).

---

## Architectural Process Orchestration

```
user-list.component (search, sort, status toggles)
        ▼
UserStore.setFilter / setPage / setPageSize
        ▼
UserFilterCriteria + PaginationState (this file)
        ▼
UserService.getUsers(filter, page, pageSize)
        ▼
HttpParams: search, status, sortBy, sortDirection, page, size
        ▼
GET /api/v1/users → PageResponse<User>
        ▼
UserStore patches users[] + pagination.totalCount
```

Scope is **user admin only** today—no shared filter types for audit logs or CAN sessions.

---

## Key Controller/Service Capabilities

| Type | Purpose | Key members |
|------|---------|-------------|
| `UserStatusFilter` | `'all' \| 'active' \| 'inactive'` | Binary active filter; `'all'` omits status query param |
| `UserFilterCriteria` | Filter + sort | `search`, `status`, `sortBy`, `sortDirection` |
| `PaginationState` | Client pager | `page` (1-based in store), `pageSize`, `totalCount` |

**Defaults in `UserStore`:** `sortBy: 'created_at'`, `sortDirection: 'desc'`, `page: 1`, `pageSize: 10`.

**Mapping rules (`UserService`):**
- `status === 'all'` → param omitted
- `search` trimmed; omitted if empty
- `page` clamped to ≥ 1

---

## Critical Design Considerations

- **Comment: “no status ENUM”** — frontend uses simplified active/inactive, not full backend `User.status` (PENDING, REJECTED, etc.).
- **PaginationState is partial** — does not mirror all `PageResponse` fields (`totalPages`, `first`, `last` computed in store).
- **Store-owned state** — types are imported only by `UserStore` and `UserService`.

---

## Gotchas & Best Practices

- **`sortBy` snake_case** (`created_at`) must match backend query parameter contract.
- Resetting filter via `setFilter` **resets page to 1**—expected UX but easy to miss when debugging pagination.
- Backend `User.status` (PENDING moderation) is **not** represented in `UserStatusFilter`—pending users use separate `getPendingUsers()` flow.
- `totalCount` comes from API `totalElements`; if API fails, count stays stale until next success.

---

## Architectural Advice & Refactoring

**Add:** `AuditLogFilterCriteria`, `SessionFilterCriteria` if list UIs grow. **Correct:** Extend status filter or dedicated tab for PENDING users. **Remove:** Duplicate filter interfaces in components—always patch via `UserStore`.

---

## Navigation Strategy

Next: `user.store_explanation.md`, `user.service_explanation.md`, `features/users/user-list/`, backend `UserControllerV1.list` query params.
