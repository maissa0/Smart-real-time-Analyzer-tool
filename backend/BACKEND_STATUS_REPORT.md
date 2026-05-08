# Able Pro IAM – Backend Implementation Report

**Document Version:** 1.0  
**Last Updated:** March 2025  
**Project:** Able Pro IAM – Identity & Access Management Backend

---

## 1. Executive Summary of Implementation

### 1.1 Finalized Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Auth** | ✅ Production | Login, register, refresh token, forgot-password, verify-otp, reset-password |
| **RBAC** | ✅ Production | Role-based access control with permissions (user:read, user:write, user:create, audit:view, billing:view) |
| **MFA** | ✅ Production | TOTP (Google Authenticator), two-step login flow, enable/confirm endpoints |
| **Sessions** | ✅ Production | Session tracking, active sessions list, session revocation with refresh token invalidation |
| **Audit Logging** | ✅ Production | Security and audit logs with pagination, filtering by action/userId |
| **Profile** | ✅ Production | Self-service profile (fullName, jobTitle, department, timezone, phone, bio), avatar upload |
| **OTP** | ✅ Production | 6-digit OTP for forgot-password, 5-minute expiry, real email delivery |

### 1.2 Production-Ready Logic Implemented

| Component | Implementation Detail |
|-----------|------------------------|
| **JWT Signing** | HMAC-SHA256 via `io.jsonwebtoken` (jjwt 0.12.6), configurable 256-bit secret |
| **Password Hashing** | BCrypt via Spring Security `BCryptPasswordEncoder` |
| **OTP Expiry** | 6-digit OTP, 5-minute expiry in `otp_codes` table, scheduled cleanup every 10 minutes |
| **Reset Token** | Short-lived JWT (15 min), type `reset`, validated before password update |
| **MFA Token** | Short-lived JWT (5 min), type `mfa_auth`, only valid for `/api/auth/mfa/verify` |
| **Session Tracking** | `sessions` table with `ip_address`, `user_agent`, `last_active`; linked to refresh tokens via `session_id` |
| **Session Heartbeat** | `SessionHeartbeatFilter` updates `last_active` on every authenticated request |
| **Token Rotation** | Refresh tokens revoked on use; new pair issued |
| **Refresh Token Storage** | SHA-256 hashed, stored in `refresh_tokens` with expiry and revocation support |

---

## 2. Final API Documentation

### 2.1 Public Endpoints (No Authentication)

| Method | URL | Function |
|--------|-----|----------|
| POST | `/api/auth/login` | Login with email/password. **Partial response:** If MFA enabled, returns `202 Accepted` with `{ "mfaRequired": true, "mfaToken": "..." }` |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/refresh` | Refresh access token using refresh token |
| POST | `/api/auth/forgot-password` | Request password reset (sends OTP email) |
| POST | `/api/auth/verify-otp` | Verify OTP, returns reset token |
| POST | `/api/auth/reset-password` | Reset password using token from verify-otp |
| POST | `/api/auth/mfa/verify` | Complete MFA login (mfaToken + 6-digit code) → returns full AuthResponse |
| GET | `/v3/api-docs/**` | OpenAPI docs |
| GET | `/swagger-ui/**` | Swagger UI |

### 2.2 Authenticated Endpoints (JWT Bearer Required)

| Method | URL | Auth Requirement | Function |
|--------|-----|------------------|----------|
| GET | `/api/v1/profile/me` | Any authenticated user | Get current user profile |
| PUT | `/api/v1/profile/me` | Any authenticated user | Update own profile |
| PATCH | `/api/v1/profile/me/password` | Any authenticated user | Change own password |
| POST | `/api/v1/profile/me/mfa/enable` | Any authenticated user | Start MFA setup (returns secret + QR URL) |
| POST | `/api/v1/profile/me/mfa/confirm` | Any authenticated user | Confirm MFA with first code |
| GET | `/api/v1/profile/me/sessions` | Any authenticated user | List own active sessions |
| POST | `/api/v1/profile/me/avatar` | Any authenticated user | Upload avatar (multipart) |
| DELETE | `/api/v1/sessions/{id}` | Own session **or** ROLE_ADMIN | Revoke session (invalidates refresh token) |

### 2.3 RBAC-Protected Endpoints

| Method | URL | Required Permission/Role | Function |
|--------|-----|--------------------------|----------|
| GET | `/api/v1/audit-logs` | `ROLE_ADMIN` or `audit:view` | List audit logs (paginated, filterable) |
| GET | `/api/v1/users` | `user:read` or `ROLE_ADMIN` | List users |
| GET | `/api/v1/users/{id}` | `user:read` or `ROLE_ADMIN` | Get user details |
| PUT | `/api/v1/users/{id}` | `user:write` or `ROLE_ADMIN` | Update user |
| PATCH | `/api/v1/users/{id}/status` | `user:write` or `ROLE_ADMIN` | Toggle user status |
| PATCH | `/api/v1/users/{id}/password` | `user:write` or `ROLE_ADMIN` | Change user password |
| GET | `/api/v1/roles` | `user:read` or `ROLE_ADMIN` | List roles |
| PUT | `/api/v1/roles/{id}/permissions` | `ROLE_ADMIN` only | Update role permissions |
| GET | `/api/v1/permissions` | `user:read` or `ROLE_ADMIN` | List permissions |

### 2.4 Partial Responses

| Endpoint | Condition | Response |
|----------|-----------|----------|
| `POST /api/auth/login` | User has `mfa_enabled = true` | `202 Accepted` with `{ "mfaRequired": true, "mfaToken": "<5-min JWT>" }` |
| `POST /api/auth/login` | User has `mfa_enabled = false` | `200 OK` with full `AuthResponse` (user, accessToken, refreshToken, permissions) |

---

## 3. Configuration & Environment Guide

### 3.1 Required Properties (application.properties / application.yml)

```properties
# Application
spring.application.name=backend

# Database (MySQL 8.0+)
spring.datasource.url=jdbc:mysql://localhost:3306/<your_schema>?createDatabaseIfNotExist=true&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC
spring.datasource.username=<your_username>
spring.datasource.password=<your_password>
spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver

# JPA / Hibernate
spring.jpa.hibernate.ddl-auto=update
spring.jpa.show-sql=false
spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.MySQLDialect

# JWT (REQUIRED: Change secret in production)
app.jwt.secret=<256-bit-secret-at-least-32-characters>
app.jwt.access-token-expiration-ms=900000
app.jwt.refresh-token-expiration-ms=604800000
app.jwt.reset-token-expiration-ms=900000
app.jwt.mfa-auth-token-expiration-ms=300000

# Server
server.port=8080

# SpringDoc / Swagger
springdoc.api-docs.path=/v3/api-docs
springdoc.swagger-ui.path=/swagger-ui.html

# Avatar upload
app.upload.dir=uploads/avatars
app.base-url=http://localhost:8080

# Mail (SMTP)
spring.mail.host=smtp.example.com
spring.mail.port=587
spring.mail.username=<smtp_username>
spring.mail.password=<smtp_password>
spring.mail.properties.mail.smtp.auth=true
spring.mail.properties.mail.smtp.starttls.enable=true
app.mail.from-name=Able Pro IAM

# MFA (optional)
app.mfa.issuer=AbleProIAM
```

### 3.2 Spring Boot Dependencies Added (pom.xml)

| Dependency | Version | Purpose |
|------------|---------|---------|
| `spring-boot-starter-mail` | (inherited) | SMTP email (forgot-password OTP, welcome emails) |
| `com.warrenstrange:googleauth` | 1.5.0 | TOTP for MFA (Google Authenticator compatible) |
| `io.jsonwebtoken:jjwt-api` | 0.12.6 | JWT creation and validation |
| `io.jsonwebtoken:jjwt-impl` | 0.12.6 | JWT implementation (runtime) |
| `io.jsonwebtoken:jjwt-jackson` | 0.12.6 | JWT JSON support (runtime) |

---

## 4. Database State & Migrations

### 4.1 Final MySQL Schema Summary

| Table | Purpose |
|-------|---------|
| `users` | User accounts (soft delete, mfa_enabled, mfa_secret, job_title, department, timezone) |
| `roles` | Role definitions |
| `permissions` | Permission slugs |
| `user_roles` | User ↔ Role (many-to-many) |
| `role_permissions` | Role ↔ Permission (many-to-many) |
| `audit_logs` | Audit and security events (action, resource, metadata JSON) |
| `sessions` | Active sessions (user_id, ip_address, user_agent, last_active) |
| `otp_codes` | Forgot-password OTPs (email, code, expires_at, used_at) |
| `refresh_tokens` | Refresh tokens (user_id, session_id, token_hash, revoked_at) |

### 4.2 Final Migration Script

Use this script to align an existing database with the current entities. Adjust `USE` to your schema name.

```sql
-- =============================================================================
-- Able Pro IAM - Final Migration Script
-- Run against your MySQL database (adjust USE statement)
-- =============================================================================

USE smart_real_time_analyser;
-- Or: USE able_pro_iam;

-- Users: add columns (run each once; skip if "Duplicate column" error)
ALTER TABLE users ADD COLUMN job_title VARCHAR(100) NULL AFTER full_name;
ALTER TABLE users ADD COLUMN department VARCHAR(100) NULL AFTER job_title;
ALTER TABLE users ADD COLUMN timezone VARCHAR(50) NULL DEFAULT 'UTC' AFTER department;
ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(255) NULL AFTER mfa_enabled;
ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL AFTER full_name;
ALTER TABLE users ADD COLUMN bio TEXT NULL AFTER phone;
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL AFTER bio;

-- OTP codes table
CREATE TABLE IF NOT EXISTS otp_codes (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  code        VARCHAR(6)   NOT NULL,
  expires_at  DATETIME(6)  NOT NULL,
  used_at     DATETIME(6)  NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_otp_codes_email (email),
  INDEX idx_otp_codes_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refresh tokens: link to session
ALTER TABLE refresh_tokens ADD COLUMN session_id BINARY(16) NULL;
-- Add FK if sessions table exists:
-- ALTER TABLE refresh_tokens ADD CONSTRAINT fk_refresh_tokens_session 
--   FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE;
```

**Migration files in project:**
- `migration-v1.sql` – Full migration (phone, bio, avatar_url, job_title, department, timezone, mfa_secret, otp_codes, session_id)
- `migration-v2.sql` – For DBs that already have phone/bio/avatar_url (adds only job_title, department, timezone, mfa_secret, otp_codes, session_id)

---

## 5. Security Architecture Audit

### 5.1 MFA Challenge Flow (Internal)

1. **Login with MFA enabled**
   - User submits email/password to `POST /api/auth/login`.
   - Credentials are validated via `AuthenticationManager`.
   - If `user.mfa_enabled == true`:
     - A short-lived JWT is generated with `type: "mfa_auth"` (5 min).
     - Response: `202 Accepted` with `{ "mfaRequired": true, "mfaToken": "<jwt>" }`.
     - No session or refresh token is created yet.

2. **MFA verification**
   - User submits `{ "mfaToken": "<jwt>", "code": "123456" }` to `POST /api/auth/mfa/verify`.
   - Endpoint is public; token is validated from the request body.
   - `JwtService` checks `type == "mfa_auth"` and expiry.
   - `MfaTotpService.verifyCode(user.mfaSecret, code)` validates TOTP.
   - On success: session is created, access token (with `sessionId` claim) and refresh token are issued.

3. **MFA token restriction**
   - `JwtAuthenticationFilter` rejects `mfa_auth` tokens when used as `Authorization: Bearer <token>`.
   - MFA tokens are only valid when sent in the request body to `/api/auth/mfa/verify`.

### 5.2 Session Revocation Flow (DB ↔ JWT)

1. **Session creation**
   - On login/register/MFA verify: a row is inserted into `sessions` (user_id, ip_address, user_agent, last_active).
   - Access token includes `sessionId` claim.
   - Refresh token is stored in `refresh_tokens` with `session_id` set.

2. **Session heartbeat**
   - `SessionHeartbeatFilter` runs after `JwtAuthenticationFilter`.
   - For each authenticated request, it reads `sessionId` from the access token and updates `sessions.last_active`.

3. **Revocation**
   - `DELETE /api/v1/sessions/{id}` is allowed if:
     - The session belongs to the current user, or
     - The current user has `ROLE_ADMIN`.
   - On revoke:
     - All `refresh_tokens` with that `session_id` have `revoked_at` set.
     - The session row is deleted.
   - Any refresh token for that session becomes invalid; the access token remains valid until it expires.

### 5.3 Endpoint Protection Summary

| Protection | Endpoints |
|------------|-----------|
| **Public** | login, register, refresh, forgot-password, verify-otp, reset-password, mfa/verify |
| **Authenticated only** | All `/api/v1/profile/me/*` (profile, password, MFA, sessions, avatar) |
| **ROLE_ADMIN or audit:view** | `GET /api/v1/audit-logs` |
| **ROLE_ADMIN or user:read** | List users, get user, list roles, list permissions |
| **ROLE_ADMIN or user:write** | Update user, toggle status, change password, delete user |
| **ROLE_ADMIN or user:create** | Create user |
| **ROLE_ADMIN only** | `PUT /api/v1/roles/{id}/permissions` |
| **Own session or ROLE_ADMIN** | `DELETE /api/v1/sessions/{id}` |

---

## 6. The Pending List

### 6.1 Mock / Placeholder Items

| Item | Current State | Production Action |
|------|---------------|-------------------|
| **SMTP credentials** | Placeholder values in `application.properties` | Configure real SMTP (e.g. SendGrid, AWS SES, Mailgun) |
| **JWT secret** | Default/example 32-char string | Use strong random secret (e.g. 256-bit) and store in secrets manager |
| **Avatar storage** | Local `uploads/avatars` directory | Use cloud storage (S3, Azure Blob) or CDN |
| **Database URL** | Localhost with hardcoded credentials | Use environment variables, connection pooling, read replicas |

### 6.2 Known Edge Cases & Technical Debt

| Item | Description |
|------|-------------|
| **Legacy refresh tokens** | Older refresh tokens may have `session_id = NULL`; heartbeat and revocation rely on session linkage. Consider backfill or migration. |
| **Email failure handling** | OTP and welcome emails use `@Async`; failures are logged but not retried. Consider dead-letter or retry. |
| **audit:view for existing DBs** | `DataInitializer` adds `audit:view` only on fresh install. Existing DBs need manual permission/role assignment. |
| **CORS** | Currently allows `http://localhost:4200` only. Update for production frontend origin(s). |
| **Rate limiting** | No rate limiting on login, forgot-password, or OTP endpoints. Add for production. |
| **MFA disable** | No endpoint to disable MFA (e.g. with password confirmation). |
| **Backup codes** | No backup/recovery codes for MFA. |

### 6.3 Recommended Next Phase

1. Configure production SMTP and test email delivery.
2. Rotate JWT secret and move to environment-based configuration.
3. Implement cloud storage for avatars.
4. Add rate limiting (e.g. Bucket4j, Resilience4j).
5. Implement MFA disable with password verification.
6. Add integration tests for auth, MFA, and session flows.

---

*End of Report*
