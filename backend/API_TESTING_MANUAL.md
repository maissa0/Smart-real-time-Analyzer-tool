# Able Pro IAM – API Testing Manual

**Version:** 1.0  
**Tools:** Swagger UI, Insomnia / Postman  
**Base URL:** `http://localhost:8080`  
**Swagger UI:** `http://localhost:8080/swagger-ui.html`

---

## Default Test Accounts

| Role | Email | Password | MFA |
|------|-------|----------|-----|
| Admin | admin@ablepro.com | Admin123! | No |
| User | user@ablepro.com | User123! | No |

---

## Scenario A: The "New User" Flow (Swagger)

### Step 1: Register a New User

**Endpoint:** `POST /api/auth/register`  
**Method:** POST  
**URL:** `http://localhost:8080/api/auth/register`

**Request Body (JSON):**

```json
{
  "name": "Test User",
  "email": "testuser@example.com",
  "password": "Test123456!"
}
```

**Headers:**
- `Content-Type: application/json`

**Expected Response:** `200 OK`

```json
{
  "user": {
    "id": "uuid-string",
    "email": "testuser@example.com",
    "username": "testuser",
    "fullName": "Test User",
    "jobTitle": null,
    "department": null,
    "timezone": null,
    "phone": null,
    "bio": null,
    "avatarUrl": null,
    "isActive": true,
    "mfaEnabled": false,
    "verified": false,
    "createdAt": "2025-03-04T12:00:00.000Z",
    "roles": [{ "id": "...", "name": "User", "description": "Standard user", "permissions": [...] }]
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "permissions": [{ "id": "...", "slug": "user:read", "description": "View users" }]
}
```

### Step 2: Use the Token in Swagger "Authorize"

1. Open Swagger UI: `http://localhost:8080/swagger-ui.html`
2. Click the **Authorize** (padlock) button at the top right.
3. In the **Value** field, paste: `Bearer <your_accessToken>`  
   Example: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
4. Click **Authorize**, then **Close**.
5. Protected endpoints (e.g. `GET /api/v1/profile/me`) will now include the token automatically.

### Step 3: Call Protected Endpoints

**GET /api/v1/profile/me**

- No request body.
- Click **Execute**.
- **Expected:** `200 OK` with full `UserDetailResponse`.

---

## Scenario B: The "MFA Challenge" Flow (Insomnia / Postman)

### Step 1: Login with MFA-Enabled User

**Endpoint:** `POST /api/auth/login`  
**URL:** `http://localhost:8080/api/auth/login`

**Request Body (JSON):**

```json
{
  "email": "admin@ablepro.com",
  "password": "Admin123!"
}
```

**Headers:**
- `Content-Type: application/json`

**Expected Response:** `202 Accepted` (if MFA is enabled)

```json
{
  "mfaRequired": true,
  "mfaToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbkBhYmxlcHJvLmNvbSIsInVzZXJJZCI6IjEyMzQ1NjctODkwYS1iY2RlLWYxMjM0NTY3ODkwYSIsInR5cGUiOiJtZmFfYXV0aCIsImlhdCI6MTcwOTUwMDAwMCwiZXhwIjoxNzA5NTAwMzAwfQ.xxx"
}
```

**Action:** Copy the `mfaToken` value. It expires in 5 minutes.

### Step 2: Verify MFA Code

**Endpoint:** `POST /api/auth/mfa/verify`  
**URL:** `http://localhost:8080/api/auth/mfa/verify`

**Request Body (JSON):**

```json
{
  "mfaToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "code": "123456"
}
```

**Headers:**
- `Content-Type: application/json`

**Expected Response:** `200 OK` with full `AuthResponse` (user, accessToken, refreshToken, permissions).

**To get the 6-digit code:**
- **TOTP:** Use Google Authenticator (or similar) app after scanning the QR from `POST /api/v1/profile/me/mfa/enable`.
- **Email OTP:** If using email-based OTP for password reset, see Step 3 below.

### Step 3: Check Mailtrap for OTP (Forgot-Password Flow)

1. **Request OTP:** `POST /api/auth/forgot-password` with `{ "email": "user@example.com" }`.
2. **Open Mailtrap:** Go to [https://mailtrap.io](https://mailtrap.io) → Inbox → Sandbox.
3. **Find the email:** Subject: "Password Reset - Your Verification Code".
4. **Copy the 6-digit code** from the email body.
5. **Verify OTP:** `POST /api/auth/verify-otp` with `{ "email": "user@example.com", "code": "123456" }`.
6. **Reset password:** Use the returned `resetToken` in `POST /api/auth/reset-password`.

---

## Scenario C: Pagination & RBAC Verification

### GET /api/v1/users – Query Parameters

| Parameter | Type | Default | Example |
|-----------|------|---------|---------|
| `page` | number | 1 | 1-based page index |
| `size` | number | 10 | Page size |
| `search` | string | — | Fuzzy search on email, username, fullName |
| `status` | string | `all` | `all` \| `active` \| `inactive` |
| `roleId` | string (UUID) | — | Filter by role |
| `sortBy` | string | `created_at` | `created_at` \| `full_name` \| `email` \| `username` |
| `sortDirection` | string | `desc` | `asc` \| `desc` |

**Example (1-based pagination):**

```
GET http://localhost:8080/api/v1/users?page=1&size=10&status=active&sortBy=created_at&sortDirection=desc
```

**Headers:**
- `Authorization: Bearer <accessToken>`
- `Content-Type: application/json` (for POST/PUT/PATCH only)

**Expected Response:** `200 OK`

```json
{
  "content": [...],
  "page": 1,
  "size": 10,
  "totalElements": 42,
  "totalPages": 5,
  "first": true,
  "last": false
}
```

### Required Headers for Every Request

| Header | Purpose |
|--------|---------|
| `Content-Type: application/json` | Required for POST/PUT/PATCH with JSON body |
| `Authorization: Bearer <accessToken>` | Required for all `/api/v1/**` and `/api/auth/**` (except public auth endpoints) |

**Public endpoints (no Authorization):**

- POST /api/auth/login
- POST /api/auth/register
- POST /api/auth/refresh
- POST /api/auth/forgot-password
- POST /api/auth/verify-otp
- POST /api/auth/reset-password
- POST /api/auth/mfa/verify

---

## Error Case Verification

### Trigger ApiError Format

**Example 1: Weak password**

**Request:** `POST /api/auth/register`

```json
{
  "name": "Test User",
  "email": "weak@example.com",
  "password": "123"
}
```

**Expected Response:** `422 Unprocessable Entity`

```json
{
  "message": "Validation failed. Please check your input.",
  "errors": {
    "password": ["Password must be at least 8 characters"]
  },
  "status": 422,
  "path": "/api/auth/register"
}
```

**Example 2: Invalid email format**

```json
{
  "name": "Test",
  "email": "not-an-email",
  "password": "ValidPass123!"
}
```

**Expected:** `422` with `"errors": { "email": ["Invalid email format"] }`

**Example 3: Email already registered**

```json
{
  "name": "Test",
  "email": "admin@ablepro.com",
  "password": "ValidPass123!"
}
```

**Expected:** `422` with `"message": "Email already registered"`

**Example 4: Invalid credentials**

**Request:** `POST /api/auth/login`

```json
{
  "email": "admin@ablepro.com",
  "password": "WrongPassword"
}
```

**Expected Response:** `401 Unauthorized`

```json
{
  "message": "Invalid email or password. Please try again.",
  "status": 401,
  "path": "/api/auth/login"
}
```

**Example 5: Missing or invalid JWT**

**Request:** `GET /api/v1/profile/me` without `Authorization` header.

**Expected Response:** `401 Unauthorized`

```json
{
  "message": "Unauthorized. Please login.",
  "status": 401,
  "path": "/api/v1/profile/me"
}
```

**Example 6: Insufficient permissions (403)**

**Request:** `GET /api/v1/audit-logs` with a user that has `ROLE_USER` only (no `audit:view`).

**Expected Response:** `403 Forbidden`

```json
{
  "message": "Access denied. You do not have permission to perform this action.",
  "status": 403,
  "path": "/api/v1/audit-logs"
}
```

---

## Cheat Sheet: Auth/MFA Lifecycle

| Step | Method | URL | Request Body | Expected Status |
|------|--------|-----|--------------|-----------------|
| 1. Register | POST | /api/auth/register | `{ "name", "email", "password" }` | 200 |
| 2. Login (no MFA) | POST | /api/auth/login | `{ "email", "password" }` | 200 |
| 2. Login (MFA on) | POST | /api/auth/login | `{ "email", "password" }` | 202 |
| 3. MFA verify | POST | /api/auth/mfa/verify | `{ "mfaToken", "code" }` | 200 |
| 4. Refresh | POST | /api/auth/refresh | `{ "refreshToken" }` | 200 |
| 5. Forgot password | POST | /api/auth/forgot-password | `{ "email" }` | 200 |
| 6. Verify OTP | POST | /api/auth/verify-otp | `{ "email", "code" }` | 200 |
| 7. Reset password | POST | /api/auth/reset-password | `{ "resetToken", "newPassword" }` | 200 |
| 8. Get profile | GET | /api/v1/profile/me | — | 200 |
| 9. MFA enable | POST | /api/v1/profile/me/mfa/enable | — | 200 |
| 10. MFA confirm | POST | /api/v1/profile/me/mfa/confirm | `{ "code" }` | 200 |
| 11. MFA disable | POST | /api/v1/profile/me/mfa/disable | `{ "password" }` | 200 |

---

## Cheat Sheet: JSON Payloads (Copy-Paste)

### Register

```json
{"name":"Test User","email":"test@example.com","password":"Test123456!"}
```

### Login

```json
{"email":"admin@ablepro.com","password":"Admin123!"}
```

### MFA Verify

```json
{"mfaToken":"<paste from 202 response>","code":"123456"}
```

### Refresh Token

```json
{"refreshToken":"<paste from login/register response>"}
```

### Forgot Password

```json
{"email":"admin@ablepro.com"}
```

### Verify OTP

```json
{"email":"admin@ablepro.com","code":"123456"}
```

### Reset Password

```json
{"resetToken":"<paste from verify-otp>","newPassword":"NewPass123!"}
```

### MFA Confirm

```json
{"code":"123456"}
```

### MFA Disable

```json
{"password":"Admin123!"}
```

### Update Profile

```json
{"fullName":"Admin User","jobTitle":"Lead","department":"IT","timezone":"UTC","phone":"+1234567890","bio":"Hello"}
```

### Change Password

```json
{"currentPassword":"Admin123!","newPassword":"NewAdmin123!"}
```

---

## Quick Reference: HTTP Status Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (MFA required – use mfaToken) |
| 204 | No Content (success, empty body) |
| 401 | Unauthorized (missing/invalid JWT or wrong credentials) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 422 | Unprocessable Entity (validation errors) |
| 429 | Too Many Requests (rate limit: login, forgot-password, verify-otp) |
| 500 | Internal Server Error |

---

*End of API Testing Manual*
