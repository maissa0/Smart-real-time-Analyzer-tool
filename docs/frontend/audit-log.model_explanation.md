# `audit-log.model.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/models/audit-log.model.ts`

---

## Executive Summary

`audit-log.model.ts` defines **audit trail and active-session DTOs** aligned with backend camelCase IAM APIs: `AuditLog` for compliance events and `Session` for device/login session management under profile settings.

**Business value:** Typed views of who changed what (audit) and where the user is logged in (sessions)—supporting admin compliance UI and self-service security center.

---

## Architectural Process Orchestration

```
Backend @AuditLog AOP + security events
        ▼
GET /api/v1/audit-logs, /me
        ▼
AuditService → AuditLog[]
        ▼
audit-log.component, user-detail-panel

GET /api/v1/profile/me/sessions
        ▼
ProfileService → Session[]
        ▼
active-sessions.component
```

Integration Guide section 3.4 (Session), 3.5 (AuditLog).

---

## Key Controller/Service Capabilities

| Interface | Purpose | Notable fields |
|-----------|---------|----------------|
| `AuditLog` | Immutable audit record | `action`, `resource`, `resourceId`, `metadata`, `source`: `'audit'` \| `'security'`, `ipAddress`, `userAgent` |
| `Session` | Active login session | `device`, `lastActive`, `createdAt` |

Both use string UUIDs for `id`; timestamps as ISO strings.

---

## Critical Design Considerations

- **`metadata` as `Record<string, unknown>`** — flexible JSON blob from backend; UI should guard unknown keys.
- **`source` union** — distinguishes security vs general audit streams for filtering/badge UI.
- **Separate from `CanSession`** — naming collision risk; CAN uses `can.model.ts`.

---

## Gotchas & Best Practices

- `userId` nullable on system-generated audit rows.
- Some components import from barrel (`data/models`), others from `audit-log.model` directly—equivalent types.
- Session revoke uses `Session.id` with `ProfileService.revokeSession`.

---

## Architectural Advice & Refactoring

**Add:** Typed metadata variants per `action` if backend stabilizes schema. **Correct:** Rename CAN session type alias in docs to avoid confusion with IAM `Session`. **Remove:** Nothing.

---

## Navigation Strategy

Next: `audit.service_explanation.md`, `profile.service_explanation.md`, `features/settings/audit-log/`, backend `AuditLogResponse.java`.
