Visual & UI Design Specification: "Able Pro" Style

General Theme:

    Palette: Clean white backgrounds, light gray borders (#f1f1f1), and a primary "Action Blue" (#4680ff) for buttons and active states.

    Typography: Sans-serif (Inter or Public Sans), using high contrast for headers and muted gray for subtext/labels.

    Shadows: Soft, subtle elevation for cards and dropdowns.

Component-Specific Instructions:

    Top Navigation Bar:

        Implement a persistent top bar with a "Search" input (shortcut Ctrl + K).

        Right-side utility icons: Layout switcher, Language, Notifications (with green dot), and the Profile Toggle.

        Profile Dropdown: Clicking the avatar must open a card showing:

            User Info (Avatar, Name, Role).

            Tabs for "Profile" and "Setting".

            Quick links: "Edit profile", "View Profile", and a red Logout icon.

    Sidebar (Drawer):

        Multi-level navigation with categories (Dashboard, Widget, Applications).

        Active states must use a left-border indicator or a light blue background tint.

    Authentication Suite (Auth-Card Style):

        Sign In/Up: Social buttons at the top (Facebook, Twitter, Google), "OR" divider, followed by form fields.

        Verification: 4-digit individual input boxes with auto-focus transition.

        Feedback: Clear "Check Your Mail" success cards with blue primary buttons.

    User List (Data Table):

        Columns: #, User Profile (Avatar + Name + Email + Verified Badge), Status, and Action.

        Status Badges: Rounded-pill style. Green (Active), Gray (Inactive). Binary is_active only.

        Actions: Icon-based (Chat, Block/Delete).

    User Profile & Settings (Tabs):

        Horizontal tab bar: Profile, Personal, My Account, Change Password, Settings.

        Layout: 2-column grid. Left side for User Summary; Right side for "About Me" and "Personal Details" cards.