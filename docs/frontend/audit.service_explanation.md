# `audit.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/audit.service.ts`

---

## Executive Summary

`AuditService` is a thin **HTTP facade** for reading **audit log entries** from the Java IAM API. It supports paginated global audit queries (with optional filters) and a convenience endpoint for the current user's own audit trail.

**Business value:** Powers compliance-oriented UI (settings audit log, user detail panels) by surfacing who did what on sensitive actions—aligned with backend `@AuditLog` AOP on controllers.

---

## Architectural Process Orchestration

```
AuditLogComponent / UserDetailPanel
        │ inject(AuditService)
        ▼
GET /api/v1/audit-logs?page&size&action&userId
GET /api/v1/audit-logs/me?page&size
        │ JWT via authInterceptor
        ▼
AuditLogControllerV1 (Java) → MySQL audit_logs
```

No Kafka/Python involvement.

---

## Key Controller/Service Capabilities

| Method | Endpoint | Responsibility |
|--------|----------|----------------|
| `getAuditLogs(page, size, action?, userId?)` | `GET /api/v1/audit-logs` | Admin-style paginated list with optional filters |
| `getMyAuditLogs(page, size)` | `GET /api/v1/audit-logs/me` | Current user's audit entries |

Returns `Observable<PageResponse<AuditLog>>`.

---

## Critical Design Considerations

- **Stateless service:** No caching; each call hits network.
- **HttpParams vs string concat:** `getAuditLogs` uses `HttpParams`; `getMyAuditLogs` uses manual query string—inconsistent but functional.
- **Root injectable:** `providedIn: 'root'`.

---

## Gotchas & Best Practices

- **`getMyAuditLogs` URL** — hard-coded `?page=` string; prefer `HttpParams` for consistency.
- **Admin-only endpoints** — backend must enforce; service has no role checks.
- **Duplicate path in UserService** — `getUserAuditLogs` hits audit API via string replace hack—prefer centralizing here.

---

## Architectural Advice & Refactoring

**Add:** Typed filter DTO; unify query building. **Correct:** Use `HttpParams` in `getMyAuditLogs`. **Remove:** Duplicate audit fetch logic from `UserService.getUserAuditLogs`.

---

## Navigation Strategy

Next: `user.service.ts`, `features/settings/audit-log/audit-log.component.ts`, backend `AuditLogControllerV1.java`.
