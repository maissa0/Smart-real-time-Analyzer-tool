# User Management Platform (IAM)

A modern Identity and Access Management (IAM) frontend built with Angular 19, inspired by the "Able Pro" design system. This application provides user management, authentication flows, profile settings, audit logging, and security features.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Features](#features)
- [Project Structure](#project-structure)
- [Data Models & Database Schema](#data-models--database-schema)
- [Routes](#routes)
- [State Management](#state-management)
- [Getting Started](#getting-started)
- [Design System](#design-system)
- [Future Enhancements](#future-enhancements)

---

## Tech Stack

| Technology | Version |
|------------|---------|
| Angular | 19.x |
| TypeScript | 5.6.x |
| @ngrx/signals | 19.x |
| Tailwind CSS | 3.4.x |
| RxJS | 7.8.x |
| lucide-angular | 0.460.x |

---

## Features

### Authentication
- **Login** – Email/password sign-in with error handling and loading states
- **Sign Up** – User registration with social buttons (Facebook, Twitter, Google) and OR divider
- **Forgot Password** – Request password reset via email
- **Code Verification** – 4-digit OTP verification for password reset
- **Reset Password** – Set new password after verification
- **Auth Guard** – Protects `/admin` routes; redirects unauthenticated users to login. Also checks `is_active`; disabled accounts are logged out and redirected with "Account Disabled"
- **Token Storage** – JWT access/refresh tokens persisted in `localStorage`
- **Auth Interceptor** – Attaches Bearer token to HTTP requests

### User Management
- **User List** – Data table with sorting, pagination, and custom cell templates
- **Status Badges** – Green (Active), Gray (Inactive). Binary `is_active` only.
- **User Actions** – Deactivate, Reset Password
- **User Edit Drawer** – Slide-out panel with reactive form for editing user details
- **RBAC** – `*appHasPermission` directive for permission-based UI (e.g. `user:write`)

### Profile & Account
- **Profile** – Full Name, Username, Email (view/edit)
- **Personal** – Job Title, Department, Timezone, Phone
- **My Account** – Email, Username, Account status
- **Change Password** – Current, New, Confirm password form
- **Settings** – Email notifications, Language preferences
- **Audit Trail** – Embedded tab with activity logs and JSON metadata viewer
- **Security Center** – MFA enrollment (TOTP placeholder), Active sessions management (Revoke)

### Layout & Navigation
- **Sidebar** – Dashboard, Widgets, Users (Applications)
- **Navbar** – Search (Ctrl+K), Layout, Language, Notifications, Profile dropdown
- **Profile Dropdown** – Single Profile link, Logout
- **Breadcrumbs** – Dynamic breadcrumb navigation

### UX & Feedback
- **Toast Service** – Success, error, warning notifications
- **Error Interceptor** – 422 (field validation), 401/403/404/500+ handling
- **Skeleton Loaders** – Table and generic skeletons
- **Empty States** – Graceful handling of empty data

---

## Project Structure

```
src/app/
├── core/                    # Core services, guards, interceptors
│   ├── auth/
│   │   └── auth.guard.ts
│   ├── interceptors/
│   │   └── error.interceptor.ts
│   └── services/
│       ├── breadcrumb.service.ts
│       └── toast.service.ts
├── data/
│   ├── models/              # TypeScript interfaces (schema-aligned)
│   │   ├── user.model.ts
│   │   ├── role.model.ts
│   │   ├── permission.model.ts
│   │   ├── audit-log.model.ts
│   │   └── index.ts
│   └── types/
│       └── filter.types.ts
├── features/
│   ├── auth/                # Login, Sign Up, Forgot/Reset Password, Code Verification
│   ├── dashboard/           # Coming Soon placeholder
│   ├── profile/             # Profile & Account (tabs: Profile, Personal, Account, Password, Settings, Audit, Security)
│   ├── settings/            # Audit Log, Security Center (MFA, Active Sessions)
│   └── users/               # User List, User Edit Drawer
├── layouts/
│   └── admin-layout/        # Shell: Sidebar + Navbar + Router outlet
├── shared/
│   ├── components/
│   │   ├── breadcrumb/
│   │   ├── data-table/
│   │   ├── modal/
│   │   ├── skeleton/
│   │   └── toast/
│   ├── directives/
│   │   └── has-permission.directive.ts
│   └── layout/
│       ├── navbar/
│       └── sidebar/
├── store/
│   ├── auth.store.ts        # @ngrx/signals
│   └── user.store.ts
├── app.config.ts
├── app.routes.ts
└── app.component.ts
```

---

## Data Models & Database Schema

The frontend models align with a typical IAM database schema. See `schema.sql` in the project root for the full SQL schema. Below is the conceptual schema for backend integration.

### Users

| Column | Type | Description |
|--------|------|--------------|
| id | string (UUID) | Primary key |
| email | string | Unique, not null |
| username | string | Unique, not null |
| full_name | string | Display name |
| is_active | TINYINT(1) | Master switch: 1 = active (can log in), 0 = disabled (denied regardless of password) |
| mfa_enabled | boolean | MFA enrollment status |
| created_at | timestamp | Account creation |
| verified | boolean | Email/account verification |

### Roles

| Column | Type | Description |
|--------|------|--------------|
| id | string (UUID) | Primary key |
| name | string | e.g. Admin, User |
| description | string | Role description |

### Permissions

| Column | Type | Description |
|--------|------|--------------|
| id | string (UUID) | Primary key |
| slug | string | e.g. `user:create`, `user:write`, `billing:view` |
| description | string | Permission description |

### User-Role (Many-to-Many)

| Column | Type |
|--------|------|
| user_id | string (FK → users) |
| role_id | string (FK → roles) |

### Role-Permission (Many-to-Many)

| Column | Type |
|--------|------|
| role_id | string (FK → roles) |
| permission_id | string (FK → permissions) |

### Audit Logs / Security Logs

| Column | Type | Description |
|--------|------|--------------|
| id | string (UUID) | Primary key |
| user_id | string | Actor |
| action | string | e.g. `USER_UPDATE`, `LOGIN_SUCCESS`, `PASSWORD_RESET_REQUEST` |
| resource | string | e.g. `users`, `auth` |
| resource_id | string | Optional target ID |
| metadata | jsonb | JSON metadata (changed fields, etc.) |
| ip_address | string | Client IP |
| user_agent | string | Browser/client |
| created_at | timestamp | Event time |
| source | enum | `audit` \| `security` |

### Active Sessions

| Column | Type | Description |
|--------|------|--------------|
| id | string (UUID) | Primary key |
| user_id | string | FK → users |
| device | string | Device description |
| ip_address | string | Client IP |
| last_active | timestamp | Last activity |
| user_agent | string | Browser/client |

---

## Routes

| Path | Description | Guard |
|------|-------------|-------|
| `/` | Redirect → `/auth/login` | — |
| `/auth/login` | Login | — |
| `/auth/register` | Sign Up | — |
| `/auth/forgot-password` | Forgot Password | — |
| `/auth/verify-code` | Code Verification (4-digit) | — |
| `/auth/reset-password` | Reset Password | — |
| `/admin` | Dashboard (Coming Soon) | authGuard |
| `/admin/users/list` | User List | authGuard |
| `/admin/profile` | Profile & Account | authGuard |
| `/admin/settings/audit` | Audit Trail (standalone) | authGuard |
| `/admin/settings/security` | Security Center (standalone) | authGuard |

> **Note:** Audit Trail and Security Center are also available as tabs within Profile & Account (`/admin/profile`).

---

## State Management

### AuthStore (@ngrx/signals)

- **State:** `user`, `accessToken`, `refreshToken`, `isAuthenticated`, `permissions`
- **Computed:** `permissionSlugs`, `currentUser`, `loggedIn`
- **Methods:** `hasPermission(slug)`, `setAuth(payload)`, `setAccessToken(token)`, `logout()`
- **Persistence:** `localStorage` for tokens, user, permissions

### UserStore (@ngrx/signals)

- **State:** `users`, `isLoading`, `error`, `filter`, `pagination`
- **Computed:** `hasUsers`, `totalPages`, `hasNextPage`, `hasPrevPage`
- **Methods:** `loadAll()`, `setUsers()`, `updateUser()`, `deleteUser()`, `deactivateUser()`, `resetPassword()`, `setFilter()`, `setPage()`, `setPageSize()`

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Install

```bash
npm install
```

### Development

```bash
npm start
```

Runs at `http://localhost:4200`.

### Build

```bash
npm run build
```

Output: `dist/user-management-platform/`

### Watch (development build with file watching)

```bash
npm run watch
```

---

## Design System

**Able Pro** style:

- **Primary:** `#4680ff` (able-primary)
- **Borders:** `#f1f1f1` (able-border)
- **Font:** Inter (or Public Sans)
- **Shadows:** `shadow-able-card`, `shadow-able-dropdown`
- **Typography:** High contrast headers, muted gray for labels/subtext

Defined in `tailwind.config.js`.

---

## Future Enhancements

- [ ] Wire profile form and Change Password to API
- [ ] Implement real MFA (QR code, TOTP verification)
- [ ] Connect UserStore to backend API (replace mock data)
- [ ] Add 401 handling and refresh token logic in auth interceptor
- [ ] Implement Ctrl+K global search modal
- [ ] Add Widgets page (sidebar link exists, route not implemented)
- [ ] Add Dashboard content (currently "Coming Soon")

---

## License

Private project.
