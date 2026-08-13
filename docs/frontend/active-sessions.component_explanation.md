# `active-sessions.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/settings/security-center/active-sessions/active-sessions.component.ts`

---

## Executive Summary

`ActiveSessionsComponent` lists **active login sessions** for the current user and supports **revoke** (logout device). It loads via `ProfileService.getSessions()` and deletes via `ProfileService.revokeSession(id)`.

**Business value:** Self-service session hygiene—complement to MFA in Security Center / profile.

---

## Architectural Process Orchestration

```
ngOnInit → loadSessions()
        ▼
GET /api/v1/profile/me/sessions
        ▼
sessions signal → template list
        ▼
revokeSession(session) → DELETE /api/v1/sessions/{id}
        ▼
Remove from list + ToastService.success
```

Uses IAM `Session` type from `audit-log.model.ts` (device, ipAddress, lastActive).

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `sessions` | `Session[]` |
| `isLoading` | Initial fetch |
| `revokingId` | Per-row loading during revoke |
| `loadSessions()` | GET sessions |
| `revokeSession()` | DELETE + filter local list |

---

## Critical Design Considerations

- **Child of SecurityCenter** — no `embedded` input; always shown in grid.
- **Toast on success** — errors rely on `errorInterceptor` only (no inline message).
- **OnPush + signals**.

---

## Gotchas & Best Practices

- **Revoke URL** — `ProfileService` uses `/api/v1/sessions/{id}` not under `/profile/me/sessions/{id}`—must match backend.
- Cannot revoke “current session” specially marked in UI—no current-session indicator.
- Loading skeleton uses Tailwind `bg-gray-100` on dark page—may flash light boxes.
- No confirm dialog before revoke.

---

## Architectural Advice & Refactoring

**Add:** Highlight current session; confirm revoke; dark skeleton styles. **Correct:** Handle revoke error toast in component. **Remove:** Nothing.

---

## Navigation Strategy

Next: `active-sessions.component.html`, `profile.service_explanation.md`, backend session endpoints.
