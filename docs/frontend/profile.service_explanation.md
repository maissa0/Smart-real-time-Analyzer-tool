# `profile.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/profile.service.ts`

---

## Executive Summary

`ProfileService` wraps **self-service profile APIs** under `/api/v1/profile/me`: read/update profile, avatar upload, MFA enable/disable, active session listing and revocation. Used by settings/profile UI for the logged-in user (not admin user CRUD).

**Business value:** Lets operators manage their own account security (MFA, sessions) without admin intervention.

---

## Architectural Process Orchestration

```
Settings / Profile components
        ▼
ProfileService
        ▼
GET/PUT/PATCH/POST/DELETE /api/v1/profile/me/...
        ▼
ProfileControllerV1 (Java) → UserEntity, sessions, avatar storage
```

JWT required on all calls via `authInterceptor`.

---

## Key Controller/Service Capabilities

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `getProfile()` | GET `/me` | Current user profile DTO |
| `updateProfile(body)` | PUT `/me` | Name, email, etc. |
| `uploadAvatar(file)` | POST `/me/avatar` | Multipart upload |
| `enableMfa()` | POST `/me/mfa/enable` | Start MFA setup |
| `disableMfa(code)` | POST `/me/mfa/disable` | Turn off MFA |
| `getSessions()` | GET `/me/sessions` | Active login sessions |
| `revokeSession(sessionId)` | DELETE `/me/sessions/{id}` | Log out device |

---

## Critical Design Considerations

- **Multipart avatar** — uses `FormData`; interceptor must not force JSON Content-Type.
- **Separate from UserService** — admin edits other users; this edits `me` only.

---

## Gotchas & Best Practices

- After profile/MFA changes, **AuthStore may be stale** — refresh user claims if needed.
- Avatar URL may need cache-busting query param after upload.

---

## Architectural Advice & Refactoring

**Add:** Sync profile updates into `AuthStore.user` signal. **Correct:** Typed response DTOs instead of loose bodies. **Remove:** Nothing.

---

## Navigation Strategy

Next: `features/settings/` profile components, backend `ProfileControllerV1.java`.
