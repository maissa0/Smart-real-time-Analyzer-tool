Markdown

# Technical Specification: Angular User Management Platform (B2C)

## 1. Core Architecture Stack
- **Framework:** Angular 18+ (Strict Mode enabled).
- **Reactivity:** Angular Signals (No RxJS for simple state; RxJS only for API streams).
- **State Management:** `@ngrx/signals` (Component Store pattern).
- **Styling:** Tailwind CSS + Headless UI (or Angular Material for base components).
- **Form Strategy:** Strictly Typed Reactive Forms.

## 2. Project Structure (Standardized)
The agent must scaffold the project using this hierarchy:
```text
src/app/
├── core/                # Singleton Services, Auth Interceptors, Guards
├── shared/              # Reusable UI (Buttons, Tables, Modals), Directives, Pipes
├── features/            # Lazy-loaded feature modules (Auth, User Management)
├── store/               # SignalStores for global state (UserStore, AuthStore)
└── data/                # TypeScript Interfaces/Models & API Endpoint Mappings

3. Database & Model Alignment

The frontend models must map to the following schema:

    User: id, email, username, full_name, is_active, mfa_enabled, created_at.

    Role: id, name, description.

    Permission: id, slug, description.

    Relationship: Users have many Roles; Roles have many Permissions.

4. Key Implementation Features
A. Authorization Directive (*appHasPermission)

Implement a structural directive that hides/shows elements based on the current user's permission slugs.

    Logic: if (user.permissions.includes(requiredPermission)) { render }

B. Signal-Based Store (UserStore)

Implement a store using @ngrx/signals to manage:

    users: Array of user objects.

    isLoading: Boolean.

    filter: Search/Sort criteria.

    Methods: loadAll(), updateUser(), deleteUser(), setFilter().

C. Security Interceptor

    Intercept all HttpClient requests.

    Attach Authorization: Bearer <token> from localStorage or AuthStore.

    Handle 401 Unauthorized by triggering a logout flow.

5. View Specifications
User Directory (Table View)

    Server-side pagination support.

    Status badges (Active/Inactive).

    Action menu: Edit, Reset Password, Deactivate, Delete.

User Detail (Edit View)

    Tabbed interface: General Info, Roles & Permissions, Security Logs.

    Multi-select dropdown for assigning Roles.

6. Development Principles

    Zero 'any': Everything must be typed.

    OnPush Change Detection: Use ChangeDetectionStrategy.OnPush for all components.

    Error Handling: Centralized Toast notification service for API errors.

    Validation: Real-time feedback on forms (email regex, password strength).