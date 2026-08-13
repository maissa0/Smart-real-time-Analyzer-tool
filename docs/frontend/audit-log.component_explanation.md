# `audit-log.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/settings/audit-log/audit-log.component.ts`

---

## Executive Summary

`AuditLogComponent` displays a **read-only paginated audit log table** with JSON metadata modal. It branches API calls on `embedded` input: **current user's logs** in profile vs **global logs** on `/admin/settings/audit`.

**Business value:** Compliance visibility for security/account actions (login, user changes, car CRUD, etc.) from backend `@AuditLog` AOP.

---

## Architectural Process Orchestration

```
ngOnInit → loadLogs()
        ▼
embedded() === true  → AuditService.getMyAuditLogs(0, 20)
embedded() === false → AuditService.getAuditLogs(0, 20)
        ▼
GET /api/v1/audit-logs/me  OR  /api/v1/audit-logs
        ▼
logs signal → template table
        ▼
onViewMetadata → selectedLog modal (JSON pretty-print)
```

Breadcrumb set only when not embedded.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `embedded` | Signal input — profile vs admin mode |
| `logs` | `AuditLog[]` from first page only |
| `isLoading` | Fetch state |
| `selectedLog` | Metadata modal target |
| `loadLogs()` | Single page fetch (no pagination UI) |
| `getMetadataDisplay()` | `JSON.stringify(metadata, null, 2)` |

Uses `AuditLog` from `audit-log.model.ts`.

---

## Critical Design Considerations

- **Page 0, size 20 hard-coded** — no “load more” or filters in UI.
- **Admin mode** may require backend permission for global audit list.
- **OnPush + signals** — no store; local component state.

---

## Gotchas & Best Practices

- Errors in `loadLogs` silently clear loading only—no toast.
- Standalone admin view fetches **all** logs—verify RBAC on backend for non-admin users.
- `embedded` not synced to route—profile tab vs settings URL differ in data scope.
- No refresh button—must re-navigate to reload.

---

## Architectural Advice & Refactoring

**Add:** Pagination, action filter, error toast; refresh control. **Correct:** Align page index with `UserService` / backend convention docs. **Remove:** Nothing.

---

## Navigation Strategy

Next: `audit-log.component.html`, `audit.service_explanation.md`, backend `AuditLogControllerV1`.
