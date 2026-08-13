# `active-sessions.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/settings/security-center/active-sessions/active-sessions.component.html`

---

## Executive Summary

This template renders the **Active Sessions** card: title, loading skeletons, session rows (device, IP, last active), and Revoke buttons with disabled/loading states.

**Business value:** Clear session list UX within Security Center grid.

---

## Architectural Process Orchestration

```
isLoading() → 3 pulse skeleton rows
        ▼
@for (sessions()) → device info + Revoke button
        ▼
@click revokeSession(session)
        ▼
@empty → "No active sessions"
```

Pure presentation bound to component signals.

---

## Key Controller/Service Capabilities

| Element | Binding |
|---------|---------|
| Header | Static copy + KPIT dark card styles |
| Session row | `session.device`, `session.ipAddress`, `lastActive \| date:'medium'` |
| Revoke | `[disabled]="revokingId() === session.id"`, “Revoking...” label |
| Scroll | `max-height:320px` on list |

---

## Critical Design Considerations

- **External template** — paired with `.ts` file.
- **Mixed themes** — skeleton uses Tailwind `animate-pulse bg-gray-100`; card uses inline dark colors.

---

## Gotchas & Best Practices

- `session.device` may be null—template shows blank title without fallback.
- No icon for device type (mobile/desktop).
- Revoke is immediate—no confirmation modal in template.

---

## Architectural Advice & Refactoring

**Add:** Fallback “Unknown device”; confirm dialog. **Correct:** Dark-theme skeleton. **Remove:** Nothing.

---

## Navigation Strategy

Next: `active-sessions.component.ts`, `security-center.component.ts`.
