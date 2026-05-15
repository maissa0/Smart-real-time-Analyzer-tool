Admin clicks "Invite User"
    ↓ POST /api/v1/users/invite
Backend creates user + generates JWT reset token (15 min)
    ↓ sendInvitationEmail()
Gmail SMTP → real email with "Set My Password" button
    ↓ link: http://localhost:4200/auth/set-password?token=xxx
User clicks link → SetPasswordComponent loads
    ↓ reads token from URL query param
User enters password + confirm → POST /api/auth/set-password
    ↓ no Bearer token attached (PUBLIC_AUTH_PATHS)
Backend validates token → sets password → user can login
    ↓ success screen → Go to Login
User logs in with email + new password ✅