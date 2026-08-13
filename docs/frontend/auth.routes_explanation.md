# `auth.routes.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/auth/auth.routes.ts`

---

## Executive Summary

`auth.routes.ts` defines the **lazy-loaded route table** for all unauthenticated IAM screens under the `/auth` prefix. It maps URL segments to standalone auth components (login, register, MFA, password recovery, invitation set-password) and provides default/wildcard redirects to login.

**Business value:** Central registry for the public auth shell—separates identity flows from `authGuard`-protected `/admin` routes in `app.routes.ts`.

---

## Architectural Process Orchestration

```
Browser URL
        ▼
app.routes.ts: path 'auth' → loadChildren(authRoutes)
        ▼
auth.routes.ts → loadComponent (lazy chunk per screen)
        ▼
Auth component (login, sign-up, …)
        ▼
AuthService / HttpClient → POST /api/auth/*
        ▼
Success → AuthStore + navigate /admin/*   OR   stay in /auth/* wizard
```

```
/  → redirect auth/login          (app.routes)
/auth  → redirect login           (auth.routes)
/auth/** unknown → redirect login   (auth.routes)
/admin/* → authGuard required       (app.routes — not this file)
```

No guards are declared here—all `/auth/*` routes are **public**.

---

## Key Controller/Service Capabilities

| Route path | Full URL | Component | API wired (audit) |
|------------|----------|-----------|-------------------|
| `''` | `/auth` | redirect → `login` | — |
| `login` | `/auth/login` | `LoginComponent` | ✅ |
| `register` | `/auth/register` | `SignUpComponent` | ✅ |
| `forgot-password` | `/auth/forgot-password` | `ForgotPasswordComponent` | ❌ UI only |
| `verify-code` | `/auth/verify-code` | `CodeVerificationComponent` | ❌ UI only |
| `mfa-verify` | `/auth/mfa-verify` | `MfaVerifyComponent` | ✅ |
| `reset-password` | `/auth/reset-password` | `ResetPasswordComponent` | ❌ UI only |
| `set-password` | `/auth/set-password` | `SetPasswordComponent` | ✅ |
| `**` | any unknown under `/auth` | redirect → `login` | — |

All feature routes use **`loadComponent`** dynamic imports (route-level code splitting).

**Export:** `authRoutes: Route[]` consumed by `app.routes.ts` via `loadChildren`.

---

## Critical Design Considerations

- **No route guards** — MFA and OTP steps rely on in-memory state (`MfaStateService`) or query params (`set-password?token=`), not router guards.
- **Path vs folder naming** — URL `register` loads `./sign-up/sign-up.component` (not `sign-up` path segment).
- **Recovery chain order is conventional only** — routes do not enforce `forgot-password → verify-code → reset-password` sequencing.
- **Wildcard `**`** — unknown auth URLs fall back to login (safe default, may hide 404 debugging).

---

## Gotchas & Best Practices

- **`/auth/register` vs component name `SignUpComponent`** — links in templates use `/auth/register`.
- **`verify-code` not linked** from forgot-password success UI—recovery subgraph partially orphaned in navigation.
- **`mfa-verify`** reachable without prior login—component handles missing token client-side.
- **`set-password`** expects `?token=` query param—not declared in route `data`.
- Adding a route requires: component file, entry here, and usually `PUBLIC_AUTH_PATHS` in `app.config.ts` if new API endpoints.

---

## Architectural Advice & Refactoring

**Add:** `canActivate` guards for `mfa-verify` (requires `MfaStateService` token) and recovery steps (requires email/resetToken in state); route `data: { title }` for breadcrumbs. **Correct:** Wire forgot-password chain or remove dead routes. **Remove:** Duplicate redirects if consolidating with `app.routes` only.

---

## Navigation Strategy

Next: `app.routes.ts`, `app.config.ts` (PUBLIC_AUTH_PATHS), per-route component `*_explanation.md` files in `features/auth/*`, `auth.guard_explanation.md`.
