# Able Pro IAM – Frontend Integration Guide

**Version:** 1.0  
**Last Updated:** March 2025  
**Purpose:** Definitive technical contract for Angular 19 frontend integration with the Spring Boot backend API.

---

## 1. API Catalog (The "Handshake" Table)

### 1.1 Authentication Endpoints (Public)

| Method | Path | Auth | Request Payload | Success Response | Status |
|--------|------|------|-----------------|------------------|--------|
| **POST** | `/api/auth/login` | Public | `{ "email": "string", "password": "string" }` | See §1.1.1 or §2 (MFA) | 200 or 202 |
| **POST** | `/api/auth/register` | Public | `{ "name": "string", "email": "string", "password": "string" }` | AuthResponse | 200 |
| **POST** | `/api/auth/refresh` | Public | `{ "refreshToken": "string" }` | AuthResponse | 200 |
| **POST** | `/api/auth/forgot-password` | Public | `{ "email": "string" }` | (empty body) | 200 |
| **POST** | `/api/auth/verify-otp` | Public | `{ "email": "string", "code": "string" }` | `{ "resetToken": "string", "expiresInSeconds": number }` | 200 |
| **POST** | `/api/auth/reset-password` | Public | `{ "resetToken": "string", "newPassword": "string" }` | (empty body) | 200 |
| **POST** | `/api/auth/mfa/verify` | Public | `{ "mfaToken": "string", "code": "string" }` | AuthResponse | 200 |

#### 1.1.1 AuthResponse (200 OK – Login / Register / Refresh / MFA Verify)

```json
{
  "user": {
    "id": "uuid-string",
    "email": "string",
    "username": "string",
    "fullName": "string",
    "jobTitle": "string | null",
    "department": "string | null",
    "timezone": "string | null",
    "phone": "string | null",
    "bio": "string | null",
    "avatarUrl": "string | null",
    "isActive": true,
    "mfaEnabled": false,
    "verified": true,
    "createdAt": "2025-03-04T10:00:00.000Z",
    "roles": [{ "id": "string", "name": "string", "description": "string", "permissions": [...] }]
  },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "permissions": [
    { "id": "string", "slug": "user:read", "description": "View users" }
  ]
}
```

**Field types:** `expiresIn` is seconds (e.g. 900 = 15 min). All `DATETIME` fields use ISO-8601 strings.

---

### 1.2 Profile Endpoints (JWT Required)

| Method | Path | Auth | Request Payload | Success Response | Status |
|--------|------|------|-----------------|------------------|--------|
| **GET** | `/api/v1/profile/me` | JWT | — | UserDetailResponse | 200 |
| **PUT** | `/api/v1/profile/me` | JWT | UserProfileUpdateRequest | UserDetailResponse | 200 |
| **PATCH** | `/api/v1/profile/me/password` | JWT | `{ "currentPassword": "string", "newPassword": "string" }` | (empty) | 200 |
| **POST** | `/api/v1/profile/me/mfa/enable` | JWT | — | `{ "secret": "string", "qrCodeUrl": "string" }` | 200 |
| **POST** | `/api/v1/profile/me/mfa/confirm` | JWT | `{ "code": "string" }` | `{ "backupCodes": ["string", ...] }` | 200 |
| **POST** | `/api/v1/profile/me/mfa/disable` | JWT | `{ "password": "string" }` | (empty) | 200 |
| **GET** | `/api/v1/profile/me/sessions` | JWT | — | `SessionResponse[]` | 200 |
| **POST** | `/api/v1/profile/me/avatar` | JWT | `multipart/form-data` with `file` | `{ "avatarUrl": "string" }` | 200 |

**UserProfileUpdateRequest** (all fields optional):

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

---

### 1.3 User Management Endpoints (RBAC: user:read / user:write / ROLE_ADMIN)

| Method | Path | Auth | Request Payload | Success Response | Status |
|--------|------|------|-----------------|------------------|--------|
| **GET** | `/api/v1/users` | user:read or ADMIN | Query params (see §4) | PageResponse\<UserResponse\> | 200 |
| **GET** | `/api/v1/users/{id}` | user:read or ADMIN | — | UserDetailResponse | 200 |
| **PUT** | `/api/v1/users/{id}` | user:write or ADMIN | UserProfileUpdateRequest | UserDetailResponse | 200 |
| **PATCH** | `/api/v1/users/{id}/status` | user:write or ADMIN | — | (empty) | 200 |
| **PATCH** | `/api/v1/users/{id}/password` | user:write or ADMIN | `{ "currentPassword": "string", "newPassword": "string" }` | (empty) | 200 |

---

### 1.4 Roles & Permissions (RBAC)

| Method | Path | Auth | Request Payload | Success Response | Status |
|--------|------|------|-----------------|------------------|--------|
| **GET** | `/api/v1/roles` | user:read or ADMIN | — | RoleWithPermissionsResponse[] | 200 |
| **PUT** | `/api/v1/roles/{id}/permissions` | ROLE_ADMIN only | `{ "permissionIds": ["uuid", ...] }` | RoleWithPermissionsResponse | 200 |
| **GET** | `/api/v1/permissions` | user:read or ADMIN | — | PermissionSlugResponse[] | 200 |

---

### 1.5 Sessions & Audit Logs

| Method | Path | Auth | Request Payload | Success Response | Status |
|--------|------|------|-----------------|------------------|--------|
| **DELETE** | `/api/v1/sessions/{id}` | Own session or ADMIN | — | (empty) | 204 |
| **GET** | `/api/v1/audit-logs` | ADMIN or audit:view | Query: `page`, `size`, `action`, `userId` | PageResponse\<AuditLogResponse\> | 200 |

---

### 1.6 Admin Health

| Method | Path | Auth | Request Payload | Success Response | Status |
|--------|------|------|-----------------|------------------|--------|
| **GET** | `/api/v1/admin/health/mail` | ROLE_ADMIN only | — | `{ "status": "string", ... }` | 200 |

---

## 2. MFA Two-Step Logic

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Step 1: POST /api/auth/login                                               │
│  Body: { "email": "...", "password": "..." }                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────────┐       ┌───────────────────────┐
        │ MFA disabled           │       │ MFA enabled            │
        │ 200 OK                 │       │ 202 Accepted            │
        │ AuthResponse           │       │ MfaAuthResponse         │
        │ (accessToken,          │       │ { "mfaRequired": true,  │
        │  refreshToken, user)   │       │   "mfaToken": "..." }   │
        └───────────────────────┘       └───────────┬─────────────┘
                                                    │
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │ Step 2: POST /api/auth/mfa/verify │
                                    │ Body: { "mfaToken": "...",     │
                                    │         "code": "123456" }     │
                                    │ 200 OK                         │
                                    │ AuthResponse (full tokens)     │
                                    └───────────────────────────────┘
```

### Frontend Logic

1. Call `POST /api/auth/login` with email and password.
2. If response status is **202**:
   - Parse body: `{ "mfaRequired": true, "mfaToken": "<jwt>" }`
   - Show MFA code input.
   - Call `POST /api/auth/mfa/verify` with `{ "mfaToken": "<from step 1>", "code": "<6-digit>" }`
   - On 200: use returned `AuthResponse` (accessToken, refreshToken, user).
3. If response status is **200**:
   - Use `AuthResponse` directly (no MFA).

**Important:** `mfaToken` is short-lived (5 min). Do not use it as `Authorization: Bearer`; it is only valid in the request body of `/api/auth/mfa/verify`.

---

## 3. Data Object Models (TypeScript Interfaces)

### 3.1 User

```typescript
interface User {
  id: string;
  email: string;
  username: string;
  fullName: string | null;
  jobTitle: string | null;
  department: string | null;
  timezone: string | null;
  phone: string | null;
  bio: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  mfaEnabled: boolean;
  verified: boolean;
  createdAt: string;  // ISO-8601
  roles?: Role[];
  permissions?: Permission[];
}
```

### 3.2 Role

```typescript
interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions?: Permission[];
}
```

### 3.3 Permission

```typescript
interface Permission {
  id: string;
  slug: string;
  description: string | null;
}
```

### 3.4 Session

```typescript
interface Session {
  id: string;
  device: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastActive: string;   // ISO-8601
  createdAt: string;   // ISO-8601
}
```

### 3.5 AuditLog

```typescript
interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  source: 'audit' | 'security';
  createdAt: string;   // ISO-8601
}
```

### 3.6 AuthResponse

```typescript
interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  permissions: Permission[];
}
```

### 3.7 MfaAuthResponse (202)

```typescript
interface MfaAuthResponse {
  mfaRequired: boolean;
  mfaToken: string;
}
```

---

## 4. Pagination & Search Contract

### 4.1 GET /api/v1/users – Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | string | — | Fuzzy search on email, username, fullName |
| `status` | string | `"all"` | `all` \| `active` \| `inactive` |
| `roleId` | string (UUID) | — | Filter by role ID |
| `sortBy` | string | `"created_at"` | `created_at` \| `full_name` \| `email` \| `username` |
| `sortDirection` | string | `"desc"` | `asc` \| `desc` |
| `page` | number | `1` | 1-based page index |
| `size` | number | `10` | Page size |

**Example:** `GET /api/v1/users?search=john&status=active&roleId=xxx&page=1&size=20&sortBy=created_at&sortDirection=desc`

### 4.2 PageResponse Wrapper

```typescript
interface PageResponse<T> {
  content: T[];
  page: number;        // 1-based
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}
```

**Example:**

```json
{
  "content": [{ "id": "...", "email": "...", ... }],
  "page": 1,
  "size": 10,
  "totalElements": 42,
  "totalPages": 5,
  "first": true,
  "last": false
}
```

### 4.3 GET /api/v1/audit-logs – Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `0` | 0-based page index |
| `size` | number | `20` | Page size |
| `action` | string | — | Filter by action |
| `userId` | string (UUID) | — | Filter by user ID |

---

## 5. Error Response Format

### 5.1 Standard ApiError (401, 403, 404, 422, 500)

```typescript
interface ApiError {
  message: string;
  errors?: Record<string, string[]>;  // field -> validation messages
  status: number;
  path: string;
}
```

**Example (422 Validation):**

```json
{
  "message": "Validation failed. Please check your input.",
  "errors": {
    "email": ["Email already registered"],
    "password": ["Password must be at least 8 characters"]
  },
  "status": 422,
  "path": "/api/auth/register"
}
```

**Example (401 Unauthorized):**

```json
{
  "message": "Invalid email or password. Please try again.",
  "status": 401,
  "path": "/api/auth/login"
}
```

**Example (404 Not Found):**

```json
{
  "message": "User not found with id: xxx",
  "status": 404,
  "path": "/api/v1/users/xxx"
}
```

### 5.2 Error Code Summary

| Status | Meaning | Typical Cause |
|--------|---------|---------------|
| **401** | Unauthorized | Invalid/expired JWT, wrong credentials |
| **403** | Forbidden | Valid JWT but insufficient permissions |
| **404** | Not Found | Resource does not exist |
| **422** | Unprocessable Entity | Validation errors (see `errors` map) |
| **429** | Too Many Requests | Rate limit exceeded (login, forgot-password, verify-otp) |
| **500** | Internal Server Error | Unexpected server error |

### 5.3 Rate Limit (429)

**Endpoints:** `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/verify-otp`  
**Limit:** 5 requests per minute per IP.

**Response body:**

```json
{
  "error": "Too many requests. Please try again later."
}
```

**Note:** Content-Type may be `application/json`. Status is `429`.

---

## 6. Database Relationship Diagram (Text-Based)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           ABLE PRO IAM – DATABASE SCHEMA                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│ users                │
├──────────────────────┤
│ id (PK, UUID)        │
│ email (UNIQUE)       │
│ username (UNIQUE)    │
│ password_hash        │
│ full_name            │
│ job_title            │
│ department           │
│ timezone             │
│ phone                │
│ bio                  │
│ avatar_url           │
│ mfa_secret           │
│ is_active            │
│ mfa_enabled          │
│ verified             │
│ created_at           │
│ updated_at           │
│ deleted_at (soft)    │
└──────────┬───────────┘
          │
          │ 1:N
          ▼
┌──────────────────────┐     N:M      ┌──────────────────────┐
│ user_roles           │◄────────────►│ roles                │
├──────────────────────┤              ├──────────────────────┤
│ user_id (FK)         │              │ id (PK, UUID)        │
│ role_id (FK)         │              │ name (UNIQUE)         │
│ created_at           │              │ description           │
└──────────────────────┘              │ created_at            │
          │                           │ updated_at            │
          │                           └──────────┬───────────┘
          │                                      │
          │                                      │ N:M
          │                                      ▼
          │                           ┌──────────────────────┐
          │                           │ role_permissions     │
          │                           ├──────────────────────┤
          │                           │ role_id (FK)          │
          │                           │ permission_id (FK)    │
          │                           │ created_at            │
          │                           └──────────┬────────────┘
          │                                      │
          │                                      ▼
          │                           ┌──────────────────────┐
          │                           │ permissions           │
          │                           ├──────────────────────┤
          │                           │ id (PK, UUID)         │
          │                           │ slug (UNIQUE)         │
          │                           │ description           │
          │                           │ created_at             │
          │                           │ updated_at             │
          │                           └───────────────────────┘
          │
          │ 1:N
          ▼
┌──────────────────────┐     ┌──────────────────────┐
│ sessions             │     │ audit_logs            │
├──────────────────────┤     ├──────────────────────┤
│ id (PK, UUID)        │     │ id (PK, UUID)         │
│ user_id (FK)         │     │ user_id (FK, nullable)│
│ device               │     │ action               │
│ ip_address           │     │ resource              │
│ user_agent           │     │ resource_id           │
│ last_active          │     │ metadata (JSON)       │
│ created_at           │     │ ip_address            │
└──────────┬───────────┘     │ user_agent            │
          │                 │ source (audit|security)│
          │ 1:N             │ created_at             │
          ▼                 └───────────────────────┘
┌──────────────────────┐
│ refresh_tokens       │     ┌──────────────────────┐
├──────────────────────┤     │ otp_codes            │
│ id (PK, UUID)        │     ├──────────────────────┤
│ user_id (FK)         │     │ id (PK, UUID)        │
│ session_id (FK)      │     │ email                │
│ token_hash (UNIQUE)  │     │ code                 │
│ device               │     │ expires_at           │
│ ip_address           │     │ used_at               │
│ user_agent           │     │ created_at            │
│ expires_at           │     └──────────────────────┘
│ revoked_at           │
│ created_at           │     ┌──────────────────────┐
└──────────────────────┘     │ mfa_recovery_codes   │
                             ├──────────────────────┤
                             │ id (PK, UUID)        │
                             │ user_id (FK)         │
                             │ code_hash            │
                             │ used_at              │
                             │ created_at           │
                             └──────────────────────┘
```

### Relationship Summary

- **User ↔ Role:** Many-to-many via `user_roles`. A user can have multiple roles.
- **Role ↔ Permission:** Many-to-many via `role_permissions`. A role has many permissions.
- **User → Session:** One-to-many. Each login creates a session.
- **Session → RefreshToken:** One-to-many. Refresh tokens are linked to sessions.
- **User → AuditLog:** One-to-many (user_id nullable for system events).

**Why User has roles[]:** The API returns the user's roles and their permissions so the frontend can show UI based on `user:read`, `user:write`, `ROLE_ADMIN`, etc.

---

## 7. Security Interceptor Rules

### 7.1 Base URL

| Environment | Base URL |
|-------------|----------|
| Local development | `http://localhost:8080` |
| Production | Configure via environment (e.g. `https://api.ablepro.com`) |

### 7.2 Required Headers

| Header | Value | When |
|--------|-------|------|
| `Authorization` | `Bearer <accessToken>` | All `/api/v1/**` and `/api/auth/**` (except public auth endpoints) |
| `Content-Type` | `application/json` | All POST/PUT/PATCH with JSON body |

**Example:**

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

### 7.3 CORS Configuration

| Setting | Value |
|---------|-------|
| Allowed origins | `http://localhost:4200` (dev) – add production origins as needed |
| Allowed methods | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` |
| Allowed headers | `*` |
| Credentials | `true` |

**Frontend:** Use `withCredentials: true` in HTTP client when calling the API.

### 7.4 Public Paths (No JWT)

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/refresh`
- `POST /api/auth/forgot-password`
- `POST /api/auth/verify-otp`
- `POST /api/auth/reset-password`
- `POST /api/auth/mfa/verify`
- `GET /v3/api-docs/**`
- `GET /swagger-ui/**`

All other `/api/**` paths require a valid JWT.

### 7.5 RBAC Quick Reference

| Permission / Role | Endpoints |
|-------------------|-----------|
| **JWT only** | Profile (me), sessions (own), avatar |
| **user:read** or **ROLE_ADMIN** | GET users, GET roles, GET permissions |
| **user:write** or **ROLE_ADMIN** | PUT users, PATCH status, PATCH password |
| **ROLE_ADMIN** only | PUT roles/{id}/permissions, GET audit-logs, GET admin/health/mail |
| **audit:view** or **ROLE_ADMIN** | GET audit-logs |
| **Own session** or **ROLE_ADMIN** | DELETE sessions/{id} |

---

## 8. Default Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@ablepro.com | Admin123! |
| User | user@ablepro.com | User123! |

---

*End of Frontend Integration Guide*
