# `app.routes.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/app.routes.ts`

---

## Executive Summary

`app.routes.ts` defines the **top-level Angular route map** for the SPA: public auth flows under `/auth/*`, protected admin app under `/admin/*` with lazy-loaded features, and fallbacks to login.

**Business value:** Single routing spine connecting IAM login, CAN analyser features, fleet, catalogs, users, settings, and profile.

---

## Architectural Process Orchestration

```
Browser URL
        ▼
appRoutes (this file)
        ├─ '' → redirect auth/login
        ├─ auth/* → loadChildren authRoutes (no guard)
        ├─ admin/* → authGuard + AdminLayoutComponent
        │     ├─ '' → DashboardComponent
        │     ├─ sniffer/* → SNIFFER_ROUTES
        │     ├─ workspace → CanWorkspaceComponent
        │     ├─ catalogs → CatalogPageComponent
        │     ├─ fleet → FleetPageComponent
        │     ├─ users/* → usersRoutes (+ adminGuard on list)
        │     ├─ settings/* → settingsRoutes
        │     └─ profile/* → profileRoutes
        └─ ** → redirect auth/login
        ▼
Lazy chunks load on first navigation
```

Registered via `provideRouter(appRoutes)` in `app.config.ts`.

---

## Key Controller/Service Capabilities

| Route | Loader | Guards |
|-------|--------|--------|
| `auth` | `auth.routes.ts` | None |
| `admin` | `AdminLayoutComponent` | `authGuard` |
| Admin children | Per-feature lazy import | Child routes may add guards (e.g. `adminGuard` on users list) |

**Not in sidebar but routed:** `/admin/sniffer` (direct URL / dashboard links).

**Auth paths:** login, register, forgot-password, verify-code, mfa-verify, reset-password, set-password.

---

## Critical Design Considerations

- **Lazy loading everywhere** — `loadComponent` / `loadChildren` for code splitting.
- **Single guard on admin parent** — all admin children inherit `authGuard`; finer RBAC on nested routes only where defined.
- **Default landing** — unauthenticated users always sent to `/auth/login`.
- **Wildcard** — unknown URLs redirect to login (not admin 404).

---

## Gotchas & Best Practices

- **`adminGuard` not on `/admin` root** — non-admin users can reach dashboard/workspace if authenticated; only users list adds admin guard.
- **No `permissionGuard`** at app level—permission slugs unused in routing.
- **Profile at `/admin/profile`** — separate from settings security tab embed.
- **Settings default** — `settingsRoutes` redirects to `audit`, not security.

---

## Architectural Advice & Refactoring

**Add:** Route `data: { breadcrumb, title }` for auto breadcrumb. **Guard:** `adminGuard` or role guard on sensitive CAN routes if needed. **Fix:** Consider `/` → `/admin` when already authenticated. **Document:** Public vs protected route matrix in README.

---

## Navigation Strategy

Next: `app.config_explanation.md`, `auth.routes_explanation.md`, `admin-layout.component_explanation.md`, `auth.guard_explanation.md`.
