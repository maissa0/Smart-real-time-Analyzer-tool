# Able Pro IAM – User Management Backend Report

**Document Version:** 2.0  
**Last Updated:** March 2025  
**Scope:** Backend analysis, APIs, DB schema, recommendations

---

## 1. What Is Implemented

### 1.1 Feature Overview

| Feature | Status | Description |
|---------|--------|-------------|
| **Authentication** | ✅ | Login, register, refresh token, forgot-password, OTP verify, reset-password |
| **MFA (TOTP)** | ✅ | Enable, confirm, disable; backup codes; two-step login flow |
| **RBAC** | ✅ | Roles (Admin, User), permissions (user:read, user:write, user:create, audit:view, billing:view) |
| **User Management** | ✅ | List, get, create, update, toggle status, soft delete, change password |
| **Profile** | ✅ | Self-service profile update, avatar upload, password change |
| **Sessions** | ✅ | List active sessions, revoke session (own or admin) |
| **Audit Logging** | ✅ | Paginated audit logs with filters |
| **Data Seeding** | ✅ | DataInitializer seeds permissions, roles, admin/user accounts |

### 1.2 What Is the "v1" Thing?

**v1 = API versioning.** It is a common pattern to keep APIs stable when you introduce breaking changes later.

| Aspect | Meaning |
|--------|---------|
| **Path** | `/api/v1/*` – versioned API surface (e.g. `/api/v1/users`, `/api/v1/profile`) |
| **Controllers** | `*ControllerV1` – classes that handle v1 endpoints |
| **DTOs** | `dto.v1` – v1-specific request/response models |
| **Services** | `UserServiceV1` – v1 user logic; other services are shared |

**Why use v1?**
- When you need breaking changes, you add `/api/v2/*` and keep v1 working.
- Clients can migrate gradually.
- Auth (`/api/auth`) is unversioned because it rarely changes in a breaking way.

---

## 2. Complete API Reference

### 2.1 Authentication (Public – No JWT)

| Method | Path | Request Payload | Response | Notes |
|--------|------|-----------------|----------|-------|
| **POST** | `/api/auth/login` | `{ "email": "string", "password": "string" }` | **200** `AuthResponse` or **202** `MfaAuthResponse` | 202 if MFA enabled |
| **POST** | `/api/auth/mfa/verify` | `{ "mfaToken": "string", "code": "123456" }` | **200** `AuthResponse` | 6-digit TOTP code |
| **POST** | `/api/auth/register` | `{ "name": "string", "email": "string", "password": "string" }` | **200** `AuthResponse` | 8+ chars password |
| **POST** | `/api/auth/refresh` | `{ "refreshToken": "string" }` | **200** `AuthResponse` | Token rotation |
| **POST** | `/api/auth/forgot-password` | `{ "email": "string" }` | **200** `void` | Sends OTP email |
| **POST** | `/api/auth/verify-otp` | `{ "email": "string", "code": "123456" }` | **200** `VerifyOtpResponse` | Returns reset token |
| **POST** | `/api/auth/reset-password` | `{ "resetToken": "string", "newPassword": "string" }` | **200** `void` | 8+ chars password |

### 2.2 Auth Response Types

**AuthResponse:**
```json
{
  "user": { "id": "...", "email": "...", "username": "...", "fullName": "...", "jobTitle": "...", "department": "...", "timezone": "...", "phone": "...", "bio": "...", "avatarUrl": "...", "isActive": true, "mfaEnabled": false, "verified": true, "createdAt": "...", "roles": [...] },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "permissions": [{ "id": "...", "slug": "user:read", "description": "View users" }]
}
```

**MfaAuthResponse (202):**
```json
{
  "mfaRequired": true,
  "mfaToken": "eyJ..."
}
```

**VerifyOtpResponse:**
```json
{
  "resetToken": "eyJ...",
  "expiresInSeconds": 900
}
```

### 2.3 Profile (Authenticated – JWT Bearer)

| Method | Path | Request | Response | Auth |
|--------|------|---------|----------|------|
| **GET** | `/api/v1/profile/me` | - | `UserDetailResponse` | Authenticated |
| **PUT** | `/api/v1/profile/me` | `UserProfileUpdateRequest` | `UserDetailResponse` | Authenticated |
| **PATCH** | `/api/v1/profile/me/password` | `SelfPasswordChangeRequest` | `void` | Authenticated |
| **POST** | `/api/v1/profile/me/mfa/enable` | - | `MfaEnableResponse` | Authenticated |
| **POST** | `/api/v1/profile/me/mfa/confirm` | `MfaConfirmRequest` | `MfaConfirmResponse` | Authenticated |
| **POST** | `/api/v1/profile/me/mfa/disable` | `MfaDisableRequest` | `void` | Authenticated |
| **GET** | `/api/v1/profile/me/sessions` | - | `List<SessionResponse>` | Authenticated |
| **POST** | `/api/v1/profile/me/avatar` | `multipart/form-data` `file` | `{ "avatarUrl": "..." }` | Authenticated |

**UserProfileUpdateRequest:**
```json
{
  "fullName": "string",
  "jobTitle": "string",
  "department": "string",
  "timezone": "string",
  "phone": "string",
  "bio": "string"
}
```

**SelfPasswordChangeRequest:**
```json
{
  "currentPassword": "string",
  "newPassword": "string"
}
```

**MfaConfirmRequest:**
```json
{
  "code": "123456"
}
```

**MfaDisableRequest:**
```json
{
  "password": "string"
}
```

**MfaEnableResponse:**
```json
{
  "secret": "string",
  "qrCodeUrl": "string"
}
```

**MfaConfirmResponse:**
```json
{
  "backupCodes": ["string", "string", ...]
}
```

**SessionResponse:**
```json
{
  "id": "uuid",
  "device": "string",
  "ipAddress": "string",
  "userAgent": "string",
  "lastActive": "string (ISO-8601)",
  "createdAt": "string (ISO-8601)"
}
```

### 2.4 User Management (v1) – `user:read` / `user:write` / ADMIN

| Method | Path | Request | Response | Auth |
|--------|------|---------|----------|------|
| **GET** | `/api/v1/users` | Query: `search`, `status`, `roleId`, `sortBy`, `sortDirection`, `page`, `size` | `PageResponse<UserResponse>` | user:read or ADMIN |
| **GET** | `/api/v1/users/{id}` | - | `UserDetailResponse` | user:read or ADMIN |
| **PUT** | `/api/v1/users/{id}` | `UserProfileUpdateRequest` | `UserDetailResponse` | user:write or ADMIN |
| **PATCH** | `/api/v1/users/{id}/status` | - | `void` | user:write or ADMIN |
| **PATCH** | `/api/v1/users/{id}/password` | `PasswordChangeRequest` | `void` | user:write or ADMIN |

**Query params (GET /api/v1/users):**
- `search` (optional): search in email, username, fullName
- `status`: `all` | `active` | `inactive` (default: `all`)
- `roleId` (optional): filter by role UUID
- `sortBy`: sort field (default: `created_at`)
- `sortDirection`: `asc` | `desc` (default: `desc`)
- `page`: 1-based (default: 1)
- `size`: page size (default: 10)

**PasswordChangeRequest:**
```json
{
  "currentPassword": "string",
  "newPassword": "string"
}
```

**UserDetailResponse:**
```json
{
  "id": "uuid",
  "email": "string",
  "username": "string",
  "fullName": "string",
  "jobTitle": "string",
  "department": "string",
  "timezone": "string",
  "phone": "string",
  "bio": "string",
  "avatarUrl": "string",
  "isActive": true,
  "mfaEnabled": false,
  "verified": true,
  "createdAt": "string",
  "roles": [{ "id": "...", "name": "...", "description": "...", "permissions": [...] }],
  "permissions": [{ "id": "...", "slug": "...", "description": "..." }]
}
```

**PageResponse:**
```json
{
  "content": [...],
  "page": 1,
  "size": 10,
  "totalElements": 100,
  "totalPages": 10,
  "first": true,
  "last": false
}
```

### 2.5 Roles & Permissions

| Method | Path | Request | Response | Auth |
|--------|------|---------|----------|------|
| **GET** | `/api/v1/roles` | - | `List<RoleWithPermissionsResponse>` | user:read or ADMIN |
| **PUT** | `/api/v1/roles/{id}/permissions` | `RolePermissionsUpdateRequest` | `RoleWithPermissionsResponse` | ADMIN only |
| **GET** | `/api/v1/permissions` | - | `List<PermissionSlugResponse>` | user:read or ADMIN |

**RolePermissionsUpdateRequest:**
```json
{
  "permissionIds": ["uuid", "uuid", ...]
}
```

**RoleWithPermissionsResponse:**
```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "permissions": [{ "id": "...", "slug": "...", "description": "..." }]
}
```

**PermissionSlugResponse:**
```json
{
  "id": "uuid",
  "slug": "string",
  "description": "string"
}
```

### 2.6 Sessions & Audit Logs

| Method | Path | Request | Response | Auth |
|--------|------|---------|----------|------|
| **DELETE** | `/api/v1/sessions/{id}` | - | `204` | Own session or ADMIN |
| **GET** | `/api/v1/audit-logs` | Query: `page`, `size`, `action`, `userId` | `PageResponse<AuditLogResponse>` | ADMIN or audit:view |

**AuditLogResponse:**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "action": "string",
  "resource": "string",
  "resourceId": "string",
  "metadata": {},
  "ipAddress": "string",
  "userAgent": "string",
  "source": "audit | security",
  "createdAt": "string"
}
```

### 2.7 Admin Health

| Method | Path | Request | Response | Auth |
|--------|------|---------|----------|------|
| **GET** | `/api/v1/admin/health/mail` | - | `{ "status": "...", ... }` | ADMIN only |

---

## 3. Database Schema

### 3.1 Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (soft delete, MFA, profile fields) |
| `roles` | Role definitions |
| `permissions` | Permission slugs |
| `user_roles` | User ↔ Role (many-to-many) |
| `role_permissions` | Role ↔ Permission (many-to-many) |
| `sessions` | Active sessions (device, IP, user agent, last active) |
| `refresh_tokens` | Refresh tokens (linked to session) |
| `audit_logs` | Audit and security events |
| `otp_codes` | Forgot-password OTPs (5-min expiry) |
| `mfa_recovery_codes` | MFA backup codes (10 per user) |

### 3.2 Schema Details

**users**
| Column | Type | Notes |
|--------|------|-------|
| id | BINARY(16) | UUID PK |
| email | VARCHAR(255) | UNIQUE |
| username | VARCHAR(100) | UNIQUE |
| password_hash | VARCHAR(255) | BCrypt |
| full_name | VARCHAR(255) | |
| job_title | VARCHAR(100) | |
| department | VARCHAR(100) | |
| timezone | VARCHAR(50) | default UTC |
| phone | VARCHAR(50) | |
| bio | TEXT | |
| avatar_url | VARCHAR(500) | |
| mfa_secret | VARCHAR(255) | TOTP secret |
| is_active | TINYINT(1) | default 1 |
| mfa_enabled | TINYINT(1) | default 0 |
| verified | TINYINT(1) | default 0 |
| created_at | DATETIME(6) | |
| updated_at | DATETIME(6) | |
| deleted_at | DATETIME(6) | soft delete |

**roles**
| Column | Type |
|--------|------|
| id | BINARY(16) |
| name | VARCHAR(100) UNIQUE |
| description | VARCHAR(500) |
| created_at | DATETIME(6) |
| updated_at | DATETIME(6) |

**permissions**
| Column | Type |
|--------|------|
| id | BINARY(16) |
| slug | VARCHAR(100) UNIQUE |
| description | VARCHAR(500) |
| created_at | DATETIME(6) |
| updated_at | DATETIME(6) |

**user_roles** (user_id, role_id)  
**role_permissions** (role_id, permission_id)

**sessions**
| Column | Type |
|--------|------|
| id | BINARY(16) |
| user_id | BINARY(16) FK |
| device | VARCHAR(255) |
| ip_address | VARCHAR(45) |
| user_agent | VARCHAR(500) |
| last_active | DATETIME(6) |
| created_at | DATETIME(6) |

**refresh_tokens**
| Column | Type |
|--------|------|
| id | BINARY(16) |
| user_id | BINARY(16) FK |
| session_id | BINARY(16) FK nullable |
| token_hash | VARCHAR(255) UNIQUE |
| device | VARCHAR(255) |
| ip_address | VARCHAR(45) |
| user_agent | VARCHAR(500) |
| expires_at | DATETIME(6) |
| revoked_at | DATETIME(6) |
| created_at | DATETIME(6) |

**audit_logs**
| Column | Type |
|--------|------|
| id | BINARY(16) |
| user_id | BINARY(16) FK nullable |
| action | VARCHAR(100) |
| resource | VARCHAR(100) |
| resource_id | VARCHAR(36) |
| metadata | JSON |
| ip_address | VARCHAR(45) |
| user_agent | VARCHAR(500) |
| source | ENUM('audit','security') |
| created_at | DATETIME(6) |

**otp_codes**
| Column | Type |
|--------|------|
| id | BINARY(16) |
| email | VARCHAR(255) |
| code | VARCHAR(6) |
| expires_at | DATETIME(6) |
| used_at | DATETIME(6) |
| created_at | DATETIME(6) |

**mfa_recovery_codes**
| Column | Type |
|--------|------|
| id | BINARY(16) |
| user_id | BINARY(16) FK |
| code_hash | VARCHAR(255) |
| used_at | DATETIME(6) |
| created_at | DATETIME(6) |

---

## 4. What Needs to Be Done / Correct / Remove / Add

### 4.1 Correct

| Item | Issue | Fix |
|------|-------|-----|
| **User creation in v1** | `UserControllerV1` has no create endpoint | Add `POST /api/v1/users` with `UserCreateRequest` |
| **User deletion in v1** | `UserControllerV1` has no delete endpoint | Add `DELETE /api/v1/users/{id}` for soft delete |
| **RegisterRequest** | Uses `name` instead of `username` | Decide: register with `username` or derive from `name`; align with frontend |
| **Profile update vs User update** | `UserControllerV1` PUT uses `UserProfileUpdateRequest` (no email/username/roles) | Decide: allow admin to change email/username/roles via PUT or add separate admin endpoint |

### 4.2 Add

| Item | Priority | Description |
|------|----------|-------------|
| **Create user (v1)** | High | `POST /api/v1/users` with `UserCreateRequest` |
| **Delete user (v1)** | High | `DELETE /api/v1/users/{id}` for soft delete |
| **Bulk user operations** | Low | Bulk deactivate, bulk role assign |
| **User export** | Low | CSV/Excel export |
| **Password policy** | Medium | Enforce complexity (uppercase, number, symbol) |
| **Account lockout** | Medium | Lock after N failed logins |
| **Email verification** | Low | Verify email on register |

### 4.3 Consolidate / Cleanup

| Item | Recommendation |
|------|----------------|
| **DTOs** | `UserServiceV1` returns `UserDetailResponse` for detail; `UserResponse` for list. |
| **Role names** | Schema uses "Admin"/"User"; DataInitializer uses same. Ensure consistency. |

### 4.4 Configuration / Production

| Item | Status | Action |
|------|--------|--------|
| SMTP | Placeholder | Configure real SMTP |
| JWT secret | Default | Use env var, 256-bit secret |
| Avatar storage | Local | Optional S3 or CDN |
| CORS | localhost:4200 | Add production origins |
| Rate limiting | Partial | Extend to auth endpoints |

---

## 5. API Summary (Quick Reference)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/mfa/verify` | Public |
| POST | `/api/auth/register` | Public |
| POST | `/api/auth/refresh` | Public |
| POST | `/api/auth/forgot-password` | Public |
| POST | `/api/auth/verify-otp` | Public |
| POST | `/api/auth/reset-password` | Public |
| GET | `/api/v1/profile/me` | Authenticated |
| PUT | `/api/v1/profile/me` | Authenticated |
| PATCH | `/api/v1/profile/me/password` | Authenticated |
| POST | `/api/v1/profile/me/mfa/enable` | Authenticated |
| POST | `/api/v1/profile/me/mfa/confirm` | Authenticated |
| POST | `/api/v1/profile/me/mfa/disable` | Authenticated |
| GET | `/api/v1/profile/me/sessions` | Authenticated |
| POST | `/api/v1/profile/me/avatar` | Authenticated |
| GET | `/api/v1/users` | user:read or ADMIN |
| GET | `/api/v1/users/{id}` | user:read or ADMIN |
| PUT | `/api/v1/users/{id}` | user:write or ADMIN |
| PATCH | `/api/v1/users/{id}/status` | user:write or ADMIN |
| PATCH | `/api/v1/users/{id}/password` | user:write or ADMIN |
| GET | `/api/v1/roles` | user:read or ADMIN |
| PUT | `/api/v1/roles/{id}/permissions` | ADMIN |
| GET | `/api/v1/permissions` | user:read or ADMIN |
| DELETE | `/api/v1/sessions/{id}` | Own or ADMIN |
| GET | `/api/v1/audit-logs` | ADMIN or audit:view |
| GET | `/api/v1/admin/health/mail` | ADMIN |

---

*End of Report*
