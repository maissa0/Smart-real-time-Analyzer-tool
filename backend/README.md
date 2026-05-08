# Able Pro IAM - Spring Boot Backend

Secure REST API for the Able Pro Identity and Access Management platform.

## Tech Stack

- **Framework:** Spring Boot 3.4+ (Java 17)
- **Security:** Spring Security 6.x with JWT (stateless)
- **Database:** MySQL 8.0+
- **Persistence:** Spring Data JPA with Hibernate
- **Validation:** Bean Validation 3.0
- **Documentation:** SpringDoc OpenAPI (Swagger UI)
- **Password:** BCrypt

## Setup

### 1. MySQL Database

Run the DDL script in MySQL Workbench (or CLI):

```bash
mysql -u root -p < src/main/resources/db/schema.sql
```

Or execute `src/main/resources/db/schema.sql` in MySQL Workbench.

### 2. Configuration

Edit `src/main/resources/application.properties`:

- `spring.datasource.url` – MySQL connection URL
- `spring.datasource.username` / `spring.datasource.password`
- `app.jwt.secret` – **Required:** 256-bit secret for JWT signing (min 32 chars)

### 3. Run

```bash
./mvnw spring-boot:run
```

API: `http://localhost:8080`  
Swagger UI: `http://localhost:8080/swagger-ui.html`

## Default Accounts

On first run, `DataInitializer` seeds:

- **Admin:** admin@ablepro.com / Admin123!
- **User:** user@ablepro.com / User123!

## API Endpoints

### Auth (public)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login |
| POST | /api/auth/register | Register |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/forgot-password | Request password reset |
| POST | /api/auth/verify-otp | Verify 6-digit OTP |
| POST | /api/auth/reset-password | Reset password with token |
| POST | /api/auth/mfa/verify | Complete MFA login |

### API v1 (User Management, RBAC, Profile, Sessions, Audit)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/users | List users (paginated, filtered by status, role, search) |
| GET | /api/v1/users/{id} | Full user details with roles and permissions |
| PUT | /api/v1/users/{id} | Update profile (fullName, phone, bio) |
| PATCH | /api/v1/users/{id}/status | Toggle is_active |
| PATCH | /api/v1/users/{id}/password | Change password (admin) |
| GET | /api/v1/roles | List roles with permissions |
| PUT | /api/v1/roles/{id}/permissions | Update role permissions |
| GET | /api/v1/permissions | Flat list of permission slugs |
| GET | /api/v1/profile/me | Current user profile |
| PUT | /api/v1/profile/me | Update own profile |
| PATCH | /api/v1/profile/me/password | Change own password |
| POST | /api/v1/profile/me/mfa/enable | Start MFA setup |
| POST | /api/v1/profile/me/mfa/confirm | Confirm MFA |
| POST | /api/v1/profile/me/mfa/disable | Disable MFA |
| GET | /api/v1/profile/me/sessions | List own sessions |
| POST | /api/v1/profile/me/avatar | Upload avatar (multipart) |
| DELETE | /api/v1/sessions/{id} | Revoke session |
| GET | /api/v1/audit-logs | List audit logs (admin/audit:view) |
| GET | /api/v1/admin/health/mail | SMTP health check (admin) |

### Query params for GET /api/v1/users

- `search` – Fuzzy search on name/email/username
- `status` – all, active, inactive
- `roleId` – Filter by role UUID
- `sortBy` – created_at, full_name, email, username
- `sortDirection` – asc, desc
- `page` – 1-based page (default 1)
- `size` – Page size (default 10)

## Error Response Format

Matches Angular Error Interceptor:

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

## CORS

Configured for `http://localhost:4200` (Angular dev server).
