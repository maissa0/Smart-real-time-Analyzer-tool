# Frontend Technical Inventory Report

**Project:** User Management Platform (Angular 19)  
**Purpose:** Pre-integration inventory for Spring Boot V1 API connection  
**Date:** Technical snapshot of current mock state

---

## Table of Contents

1. [Core Infrastructure](#1-core-infrastructure)
2. [State Management (Signals/Store)](#2-state-management-signalsstore)
3. [Services](#3-services)
4. [Components & Routing](#4-components--routing)
5. [Models & Interfaces](#5-models--interfaces)

---

## 1. Core Infrastructure

### 1.1 Interceptors

| Interceptor | File Path | Logic |
|-------------|-----------|-------|
| **AuthInterceptor** | `src/app/app.config.ts` (inline) | Reads `access_token` from `localStorage`; if present, clones request and adds `Authorization: Bearer <token>` header. No refresh token logic. |
| **ErrorInterceptor** | `src/app/core/interceptors/error.interceptor.ts` | Catches HTTP errors and displays via `ToastService`. Handles: 422 (field validation with `errors` object), 500+ (server errors), 401 (session expired), 403 (forbidden), 404 (not found), 400+ (generic), network errors. Re-throws error after toast. |
| **LoggingInterceptor** | ❌ Not present | — |

**Registration:** Both interceptors registered in `app.config.ts` via `provideHttpClient(withInterceptors([authInterceptor, errorInterceptor]))`.

---

### 1.2 Guards

| Guard | File Path | Protected Routes | Logic |
|-------|-----------|-----------------|-------|
| **authGuard** | `src/app/core/auth/auth.guard.ts` | All `/admin/*` routes (entire admin tree) | 1) If not authenticated → redirect to `/auth/login`. 2) If authenticated but `user.is_active === false` → logout, redirect to `/auth/login?reason=disabled`. 3) Otherwise allow. |
| **RoleGuard** | ❌ Not present | — | — |
| **GuestGuard** | ❌ Not present | — | — |

**Route structure:** `authGuard` is applied at `path: 'admin'`; all child routes inherit protection.

---

## 2. State Management (Signals/Store)

### 2.1 AuthStore

**File:** `src/app/store/auth.store.ts`

| Type | Name | Description |
|------|------|-------------|
| **State** | `user` | `User \| null` |
| | `accessToken` | `string \| null` |
| | `refreshToken` | `string \| null` |
| | `isAuthenticated` | `boolean` |
| | `permissions` | `string[]` (permission slugs) |
| **Computed** | `permissionSlugs` | Alias for `permissions()` |
| | `currentUser` | Alias for `user()` |
| | `loggedIn` | Alias for `isAuthenticated()` |
| **Methods** | `hasPermission(slug: string)` | Returns `permissions().includes(slug)` |
| | `setAuth(payload)` | Sets user, tokens, permissions; persists to `localStorage` |
| | `setAccessToken(token)` | Updates access token only |
| | `logout()` | Clears state and `localStorage` |

**Persistence:** `localStorage` keys: `access_token`, `refresh_token`, `auth_user`, `auth_permissions`. Hydrated on store init.

**rxMethod calls:** None.

---

### 2.2 UserStore

**File:** `src/app/store/user.store.ts`

| Type | Name | Description |
|------|------|-------------|
| **State** | `users` | `User[]` |
| | `isLoading` | `boolean` |
| | `error` | `string \| null` |
| | `filter` | `UserFilterCriteria` (search, status, sortBy, sortDirection) |
| | `pagination` | `PaginationState` (page, pageSize, totalCount) |
| **Computed** | `hasUsers` | `users().length > 0` |
| | `totalPages` | Derived from pagination |
| | `hasNextPage` | `page < totalPages` |
| | `hasPrevPage` | `page > 1` |
| **Methods** | `loadAll()` | Placeholder: sets `isLoading` then clears users (no API) |
| | `setUsers(users, totalCount?)` | Sets users and pagination |
| | `updateUser(updatedUser)` | Replaces user in list by id |
| | `deleteUser(userId)` | Removes user from list |
| | `deactivateUser(userId)` | Sets `is_active: false` for user |
| | `activateUser(userId)` | Sets `is_active: true` for user |
| | `resetPassword(userId)` | No-op placeholder |
| | `setFilter(partial)` | Merges filter, resets page to 1 |
| | `setPage(page)` | Updates pagination page |
| | `setPageSize(pageSize)` | Updates page size, resets page |
| | `setLoading(isLoading)` | Sets loading state |
| | `setError(error)` | Sets error, clears loading |
| | `reset()` | Resets to initial state |

**rxMethod calls:** None.

---

### 2.3 Mock Data Locations

| Location | File | Method/Context | Data |
|----------|------|----------------|-------|
| Login | `src/app/features/auth/login/login.component.ts` | `onSubmit()` | `mockUser`, `mockPermissions`; `setTimeout` 300ms |
| User List | `src/app/features/users/user-list/user-list.component.ts` | `getMockUsers()` | 4 users (Curtis, Xavier, Lola, Milton); called in `ngOnInit` via `userStore.setUsers(getMockUsers(), 4)` |
| User Edit Drawer | `src/app/features/users/user-edit-drawer/user-edit-drawer.component.ts` | `availableRoles` signal | 3 roles: Admin, Editor, Viewer |
| Audit Log | `src/app/features/settings/audit-log/audit-log.component.ts` | `getMockLogs()` | 4 audit log entries; `setTimeout` 600ms in `loadLogs()` |
| Active Sessions | `src/app/features/settings/security-center/active-sessions/active-sessions.component.ts` | `getMockSessions()` | 3 sessions; `setTimeout` 400ms in `loadSessions()` |
| MFA Enrollment | `src/app/features/settings/security-center/mfa-enrollment/mfa-enrollment.component.ts` | `startEnrollment()` | Mock TOTP secret `JBSWY3DPEHPK3PXP`; `setTimeout` 500ms |

---

## 3. Services

### 3.1 BreadcrumbService

**File:** `src/app/core/services/breadcrumb.service.ts`

| Method | HTTP? | Description |
|--------|-------|-------------|
| `set(items: BreadcrumbItem[])` | No | Sets breadcrumb items |
| `setFromPath(path, labels?)` | No | Builds breadcrumb from URL path |
| `clear()` | No | Clears breadcrumb |

**Data source:** In-memory signals only. No `HttpClient`.

---

### 3.2 ToastService

**File:** `src/app/core/services/toast.service.ts`

| Method | HTTP? | Description |
|--------|-------|-------------|
| `show(message, type, options?)` | No | Adds toast to list |
| `success(message, details?)` | No | Shows success toast |
| `error(message, details?)` | No | Shows error toast (8s duration) |
| `warning(message, details?)` | No | Shows warning toast |
| `info(message, details?)` | No | Shows info toast |
| `dismiss(id)` | No | Removes toast by id |
| `clear()` | No | Clears all toasts |

**Data source:** In-memory signals only. No `HttpClient`.

---

### 3.3 AuthService / UserService / ProfileService

**Status:** ❌ **Not present**

- **Auth:** Login logic is inline in `LoginComponent`; no `AuthService`. Uses `setTimeout` + `authStore.setAuth()`.
- **User:** No `UserService`. `UserStore` methods are called directly; data comes from `getMockUsers()` in `UserListComponent`.
- **Profile:** No `ProfileService`. `ProfileSettingsComponent` reads from `AuthStore.user()` and uses local form; no save API.

---

## 4. Components & Routing

### 4.1 Key Components

| Feature | Component | File | Notes |
|---------|-----------|------|-------|
| **Login** | `LoginComponent` | `src/app/features/auth/login/login.component.ts` | Form: email, password, keepSignedIn. Mock login via `setTimeout`. Handles `?reason=disabled`. |
| **User Listing** | `UserListComponent` | `src/app/features/users/user-list/user-list.component.ts` | Uses `DataTableComponent`, `UserStore`, `getMockUsers()`. Search + status filter. Deactivate/Activate/Reset Password. |
| **User Edit** | `UserEditDrawerComponent` | `src/app/features/users/user-edit-drawer/user-edit-drawer.component.ts` | Slide-out drawer. Form: full_name, email, roleIds. Emits `saved` with updated User. |
| **Profile Settings** | `ProfileSettingsComponent` | `src/app/features/profile/profile-settings/profile-settings.component.ts` | Tabbed: Profile, Personal, My Account, Change Password, Settings, Audit Trail, Security Center. Reads from `AuthStore.user()`. No save API. |
| **MFA / OTP Verification** | `MfaEnrollmentComponent` | `src/app/features/settings/security-center/mfa-enrollment/mfa-enrollment.component.ts` | TOTP enrollment: placeholder QR, 6-digit code. Mock secret. |
| **Code Verification (4-digit)** | `CodeVerificationComponent` | `src/app/features/auth/code-verification/code-verification.component.ts` | 4-digit OTP for password reset flow. Auto-focus, paste support. Navigates to `/auth/reset-password` on success. |
| **Audit Trail** | `AuditLogComponent` | `src/app/features/settings/audit-log/audit-log.component.ts` | Table + JSON metadata viewer. `embedded` input for use in Profile tab. |
| **Active Sessions** | `ActiveSessionsComponent` | `src/app/features/settings/security-center/active-sessions/active-sessions.component.ts` | List with Revoke. Mock sessions. |

---

### 4.2 Route Structure

**File:** `src/app/app.routes.ts`

```
/                    → redirectTo: auth/login
/auth                → loadChildren: auth.routes
  /login             → LoginComponent
  /register          → SignUpComponent
  /forgot-password   → ForgotPasswordComponent
  /verify-code       → CodeVerificationComponent
  /reset-password    → ResetPasswordComponent
/admin               → canActivate: [authGuard], AdminLayoutComponent
  ''                 → DashboardComponent (Coming Soon)
  /users             → loadChildren: users.routes
    /list            → UserListComponent
  /settings          → loadChildren: settings.routes
    /audit           → AuditLogComponent
    /security        → SecurityCenterComponent
  /profile           → loadChildren: profile.routes
    ''               → ProfileSettingsComponent
/**                  → redirectTo: auth/login
```

**Lazy-loaded route files:**
- `src/app/features/auth/auth.routes.ts`
- `src/app/features/users/users.routes.ts`
- `src/app/features/settings/settings.routes.ts`
- `src/app/features/profile/profile.routes.ts`

---

## 5. Models & Interfaces

### 5.1 Data Models

**File:** `src/app/data/models/`

| Interface | File | Fields |
|-----------|------|--------|
| **User** | `user.model.ts` | `id`, `email`, `username`, `full_name`, `is_active`, `mfa_enabled`, `created_at`, `roles?`, `verified?` |
| **Role** | `role.model.ts` | `id`, `name`, `description`, `permissions?` |
| **Permission** | `permission.model.ts` | `id`, `slug`, `description` |
| **AuditLog** | `audit-log.model.ts` | `id`, `user_id`, `action`, `resource`, `resource_id?`, `metadata?`, `details?`, `ip_address?`, `user_agent?`, `created_at`, `source?` |
| **ActiveSession** | `audit-log.model.ts` | `id`, `device`, `ip_address`, `last_active`, `user_agent?` |

---

### 5.2 AuthResponse / Login Payload

**Status:** No dedicated `AuthResponse` or `LoginResponse` interface.

**Current `setAuth` payload shape** (from `AuthStore`):

```typescript
{
  user: User;
  accessToken: string;
  refreshToken?: string;
  permissions?: Permission[];
}
```

**Backend contract comparison:** The Spring Boot API will likely return a different shape (e.g. `access_token`, `refresh_token`, `user` DTO). A mapping layer or adapter will be needed.

---

### 5.3 Filter & Pagination Types

**File:** `src/app/data/types/filter.types.ts`

| Type | Description |
|------|-------------|
| `UserStatusFilter` | `'all' | 'active' | 'inactive'` |
| `UserFilterCriteria` | `search`, `status`, `sortBy`, `sortDirection` |
| `PaginationState` | `page`, `pageSize`, `totalCount` |

---

### 5.4 Toast & Breadcrumb

| Interface | File | Purpose |
|-----------|------|---------|
| `Toast` | `toast.service.ts` | `id`, `message`, `type`, `details?`, `duration?`, `createdAt` |
| `BreadcrumbItem` | `breadcrumb.service.ts` | `label`, `url?` |

---

### 5.5 DataTable

**File:** `src/app/shared/components/data-table/data-table-column.interface.ts`

| Interface | Purpose |
|-----------|---------|
| `DataTableColumn<T>` | `key`, `header`, `field?`, `sortable?`, `templateKey?`, `headerClass?`, `cellClass?` |
| `DataTableCellContext<T>` | `$implicit`, `column`, `index?` |
| `DataTableActionsContext<T>` | `$implicit` |

---

## Summary: Integration Readiness

| Area | Status | Notes |
|------|--------|-------|
| **HTTP Client** | ✅ Configured | `provideHttpClient` + interceptors |
| **Auth Interceptor** | ✅ Ready | Bearer token attachment |
| **Error Interceptor** | ✅ Ready | Toast-based error handling |
| **Auth Guard** | ✅ Ready | `is_active` check included |
| **AuthService** | ❌ Missing | Login logic in component |
| **UserService** | ❌ Missing | UserStore + mock in component |
| **ProfileService** | ❌ Missing | No profile save |
| **AuthResponse mapping** | ⚠️ Needed | No interface; backend DTO will differ |
| **Mock data** | 🔄 To replace | 6 locations (login, user list, audit, sessions, MFA, roles) |

---

*End of Technical Inventory Report*
