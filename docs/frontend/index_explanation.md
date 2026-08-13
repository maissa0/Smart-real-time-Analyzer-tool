# `index.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/data/models/index.ts`

---

## Executive Summary

`index.ts` is the **barrel export** for IAM-related TypeScript types in the `data/models` layer. It re-exports `User`, `Role`, `Permission`, `AuditLog`, `Session`, `AuthResponse`, and `MfaAuthResponse` so consumers can import from a single path (`../../data/models`).

**Business value:** Reduces import noise in services, stores, and feature components; establishes a clear public API surface for identity/audit DTOs (not CAN domain types).

---

## Architectural Process Orchestration

```
Backend JSON (camelCase IAM DTOs)
        ▼
HttpClient → AuthService / UserService / AuditService / ProfileService
        ▼
Typed as User | AuthResponse | AuditLog | …
        ▼
import type { User } from '../../data/models'   ← this barrel
        ▼
AuthStore / UserStore / user-list / audit-log components
```

**CAN models are excluded** from this barrel—`CanSession`, `CanFrame`, etc. are imported directly from `can.model.ts`.

---

## Key Controller/Service Capabilities

| Re-export | Source file | Typical consumers |
|-----------|-------------|-------------------|
| `User` | `user.model.ts` | `AuthStore`, `UserStore`, `UserService`, user features |
| `Role` | `role.model.ts` | Nested in `User.roles` |
| `Permission` | `permission.model.ts` | `AuthStore`, `AuthResponse.permissions` |
| `AuditLog`, `Session` | `audit-log.model.ts` | `AuditService`, profile sessions UI |
| `AuthResponse`, `MfaAuthResponse` | `auth.model.ts` | `AuthService` login/MFA flows |

Uses `export type { … }` only—no runtime values.

---

## Critical Design Considerations

- **Type-only barrel** — tree-shaken away at compile time; no runtime module side effects.
- **Partial coverage** — intentional split: IAM via barrel, CAN via direct path.
- **Integration Guide alignment** — underlying models reference backend contract sections 3.x and auth sections 1–2.

---

## Gotchas & Best Practices

- Adding a new IAM model requires updating **both** the source file and this barrel.
- Importing CAN types from `'data/models'` will fail—use `'data/models/can.model'`.
- Mixed import styles in codebase: some use barrel, some use `audit-log.model` directly.

---

## Architectural Advice & Refactoring

**Add:** Export CAN types from barrel (or a `can/index.ts`) for consistency. **Correct:** Standardize on barrel vs deep imports per domain. **Remove:** Nothing.

---

## Navigation Strategy

Next: individual model files (`user.model.ts`, `can.model.ts`, …), `data/types/` for filter/pagination DTOs.
