# `settings.routes.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/settings/settings.routes.ts`

---

## Executive Summary

`settings.routes.ts` defines **lazy-loaded admin settings routes** under `/admin/settings`: audit trail (default) and security center. Components are also **embedded** in `/admin/profile` tabs via `[embedded]="true"` without using these URLs.

**Business value:** Standalone settings entry from sidebar; complements profile-embedded IAM UX.

---

## Architectural Process Orchestration

```
app.routes.ts: path 'settings' → loadChildren(settingsRoutes)
        ├─ /admin/settings → redirect audit
        ├─ /admin/settings/audit → AuditLogComponent (embedded=false)
        └─ /admin/settings/security → SecurityCenterComponent (embedded=false)

Parallel path:
ProfileSettingsComponent tabs → same components embedded=true
```

Protected by parent `authGuard` on `/admin`.

---

## Key Controller/Service Capabilities

| Route | Component | Standalone behavior |
|-------|-----------|---------------------|
| `''` | redirect → `audit` | — |
| `audit` | `AuditLogComponent` | Breadcrumb + all audit logs API |
| `security` | `SecurityCenterComponent` | Breadcrumb + MFA + sessions |
| `**` | redirect → `audit` | — |

---

## Critical Design Considerations

- **Dual mount pattern** — same components, `embedded` input toggles chrome and audit API scope.
- **Default audit** — settings home is compliance logs, not security.

---

## Gotchas & Best Practices

- Sidebar links `/admin/settings` → audit, not a settings hub page.
- No route for profile-like “general settings” (those live under `/admin/profile`).
- Deep-link `/admin/settings/security` works; profile security tab does not update URL.

---

## Architectural Advice & Refactoring

**Add:** Settings layout shell component; unify profile/settings navigation. **Correct:** Nothing critical. **Remove:** Nothing.

---

## Navigation Strategy

Next: `audit-log.component.ts`, `security-center.component.ts`, `sidebar.component.html`, `profile-settings.component.ts`.
