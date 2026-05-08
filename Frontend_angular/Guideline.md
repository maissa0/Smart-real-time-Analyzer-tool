Engineering Specification: Identity & Access Management (IAM) Portal
1. System Architecture & Standards

    Framework: Angular 18/19 (Signals-based).

    State Management: @ngrx/signals (SignalStore) for reactive, boilerplate-free state.

    Change Detection: OnPush (Global).

    Styling: Tailwind CSS (Utility-first) + Headless UI (Accessible components).

    API Pattern: RESTful with JSON Web Tokens (JWT) and Refresh Tokens.

2. Core Feature Set (Requirements)
A. Authentication & Recovery

    Multi-Factor Auth (MFA): Support for TOTP (Google Authenticator) via a QR code generation interface.

    Passwordless Logic: Support for Passkeys (WebAuthn) registration and login.

    Session Persistence: "Remember Me" logic with secure HTTP-only cookie handling or encrypted LocalStorage.

B. User Lifecycle Management

    User Directory: A high-performance table with:

        Fuzzy search (Name/Email).

        Status filtering (Active, Suspended, Pending).

        Bulk actions (Deactivate selected, Change roles for selected).

    User Provisioning: "Invite User" flow where an email is sent with a unique, time-limited registration token.

C. Granular RBAC (Role-Based Access Control)

    Role Manager: Interface to create/edit roles (e.g., "Editor").

    Permission Mapping: A matrix UI to toggle specific permissions (e.g., user:create, billing:view) for each role.

3. The Interface Blueprint (UI/UX)
View	Key Components	Technical Requirement
Login/Sign-up	Card-based layout, Social Auth buttons, Password strength meter.	Async validation for email uniqueness.
Admin Dashboard	Stats cards (Total users, active sessions, failed logins), Audit Feed.	Real-time updates via WebSockets or Polling.
User Table	Paginated list, Inline status toggles, "Quick Edit" drawer.	Virtual Scrolling for lists > 1,000 items.
User Profile	Profile picture upload (Crop tool), Password change, Session list.	File size/type validation for avatars.
Security Center	MFA Toggle, Recovery Codes generator, "Logout all devices" button.	Confirmation modals for destructive actions.
4. Technical Implementation Detail (For the AI Agent)
A. Folder Structure
Plaintext

src/app/
├── core/
│   ├── auth/                # AuthGuard, RoleGuard, TokenInterceptor
│   ├── services/            # ApiService, IdentityService, NotificationService
│   └── util/                # Validators, Date formatters
├── shared/
│   ├── components/          # Custom Table, Modal, Button, FormInput
│   ├── directives/          # hasPermission.directive.ts, clickOutside.directive.ts
│   └── pipes/               # RelativeTimePipe, SafeHtmlPipe
├── features/                # Lazy-Loaded Modules
│   ├── auth/                # Login, Register, Forgot Password
│   ├── users/               # UserList, UserDetail, UserInvite
│   └── settings/            # RoleManagement, AuditLogs
└── store/                   # ngrx/signals
    ├── auth.store.ts        # User state, tokens, permissions
    └── user-ui.store.ts     # Table filters, pagination state, loading states

B. The Authorization Directive

The agent must implement a structural directive to protect the UI:
TypeScript

// Usage: <button *appHasPermission="'user:delete'">Delete User</button>
@Directive({ selector: '[appHasPermission]' })
export class HasPermissionDirective {
  @Input() set appHasPermission(permission: string) {
    if (this.authStore.hasPermission(permission)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    } else {
      this.viewContainer.clear();
    }
  }
}

C. The Interceptor (Security)

The agent must ensure every outgoing request is intercepted:

    Attach Authorization: Bearer <token>.

    Catch 401 errors → Attempt Refresh Token.

    If Refresh fails → Redirect to /login.