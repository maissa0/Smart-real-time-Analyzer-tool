# `profile.routes.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/profile/profile.routes.ts`

---

## Executive Summary

`profile.routes.ts` defines the **lazy-loaded child routes** for the self-service profile area under `/admin/profile`. It maps the empty path to `ProfileSettingsComponent` and redirects unknown segments back to the default view.

**Business value:** Route module for account management—linked from navbar “Profile” and protected by parent `authGuard` on `/admin`.

---

## Architectural Process Orchestration

```
app.routes.ts: path 'profile' → loadChildren(profileRoutes)
        ▼
/admin/profile → ProfileSettingsComponent (default)
        ▼
In-component tabs (not separate routes): profile, password, settings, audit, security
        ▼
ProfileService → /api/v1/profile/me/*
```

Tab switching is **client-side** (`activeTab` signal)—only one route entry in this file.

---

## Key Controller/Service Capabilities

| Route path | Full URL | Component |
|------------|----------|-----------|
| `''` | `/admin/profile` | `ProfileSettingsComponent` |
| `**` | any unknown under profile | redirect → `''` |

**Export:** `profileRoutes: Route[]`.

Uses `loadComponent` dynamic import.

---

## Critical Design Considerations

- **Flat routing** — audit and security are tabs inside one component, not `/admin/profile/security` URLs.
- **No guards** — inherits authentication from `/admin` parent.
- **Wildcard** — deep links to non-existent profile subpaths collapse to main page.

---

## Gotchas & Best Practices

- **Bookmarking tabs** — cannot deep-link to Audit or Security tab via URL (unlike a multi-route design).
- Parallel **`/admin/settings`** routes may overlap conceptually with embedded `AuditLogComponent` / `SecurityCenterComponent`.
- Adding URL-synced tabs would require route `data` or child routes here.

---

## Architectural Advice & Refactoring

**Add:** Child routes per tab (`profile/audit`, `profile/security`) with `routerLink` sync. **Correct:** Nothing critical. **Remove:** Nothing.

---

## Navigation Strategy

Next: `profile-settings.component.ts`, `app.routes.ts`, navbar profile link, `profile.service_explanation.md`.
