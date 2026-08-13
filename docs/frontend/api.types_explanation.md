# `api.types.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/types/api.types.ts`

---

## Executive Summary

`api.types.ts` defines **cross-cutting HTTP contract types** shared by services and interceptors: generic paginated list wrapper (`PageResponse<T>`) and standardized error body (`ApiError`). These mirror Java DTOs in `com.example.backend.dto.common` and the Frontend Integration Guide sections 4.2 and 5.1.

**Business value:** One typed shape for list endpoints and global error handling—avoids duplicating pagination/error interfaces across IAM services.

---

## Architectural Process Orchestration

```
Spring Controller returns PageResponse<UserResponse> or throws → GlobalExceptionHandler → ApiError
        ▼
HttpClient JSON deserialize
        ▼
Typed as PageResponse<T> or caught as HttpErrorResponse.error
        ▼
UserService / AuditService → PageResponse<User | AuditLog>
errorInterceptor → ApiError.message, ApiError.errors
        ▼
UserStore (content, totalElements) / ToastService (user-facing messages)
```

No Kafka, WebSocket, or Python involvement—pure REST envelope types.

---

## Key Controller/Service Capabilities

| Type | Fields | Consumers |
|------|--------|-----------|
| `PageResponse<T>` | `content`, `page`, `size`, `totalElements`, `totalPages`, `first`, `last` | `UserService.getUsers`, `AuditService.getAuditLogs`, `getMyAuditLogs` |
| `ApiError` | `message`, `errors?`, `status`, `path` | `errorInterceptor` (422 validation, 401/403/404/5xx branches) |

`PageResponse` is generic—element type `T` comes from `data/models/` (e.g. `User`, `AuditLog`).

---

## Critical Design Considerations

- **Structural typing only** — interfaces compile away; no runtime validation of backend JSON.
- **Backend parity** — field names match Jackson-serialized Java `PageResponse` and `ApiError` exactly (camelCase).
- **`errors` map** — keys are field names; values are string arrays (Spring validation format).
- **No barrel file** in `data/types/` — import directly from `api.types.ts`.

---

## Gotchas & Best Practices

- **Page index inconsistency:** `UserService` sends **1-based** `page` (`Math.max(1, page)`); `AuditService` defaults `page = 0`—verify backend expects same convention per endpoint.
- `errorInterceptor` casts `err.error` to `ApiError | { message?, error? }` — 429 responses may use `error` not `message`.
- `UserStore` maps `totalElements` → `PaginationState.totalCount` but ignores `page`, `totalPages`, `first`, `last` from response—client recomputes pages locally.
- Not every error path returns full `ApiError` (network failures use `ErrorEvent`).

---

## Architectural Advice & Refactoring

**Add:** Barrel `data/types/index.ts`; map full `PageResponse` into store pagination (use server `totalPages`). **Correct:** Align audit vs user page indexing with backend. **Remove:** Ad-hoc error shapes in components— rely on interceptor + `ApiError`.

---

## Navigation Strategy

Next: `filter.types_explanation.md`, `error.interceptor_explanation.md`, backend `PageResponse.java`, `ApiError.java`, `GlobalExceptionHandler.java`.
