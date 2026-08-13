# `security-center.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/settings/security-center/security-center.component.ts`

---

## Executive Summary

`SecurityCenterComponent` is a **layout shell** for account security: MFA enrollment and active sessions side-by-side. It composes `MfaEnrollmentComponent` and `ActiveSessionsComponent`, with optional breadcrumb when not embedded in profile.

**Business value:** Single “Security Center” surface for TOTP setup and session revocation—mounted at `/admin/settings/security` or profile Security tab.

**Note:** Inline template (~15 lines); mixes Tailwind utility classes in standalone mode header.

---

## Architectural Process Orchestration

```
/admin/settings/security  OR  profile tab (embedded=true)
        ▼
SecurityCenterComponent
        ├─ app-mfa-enrollment
        └─ app-active-sessions
        ▼
ProfileService MFA + session APIs
        ▼
Backend ProfileControllerV1
```

No HTTP in shell—children own data fetching.

---

## Key Controller/Service Capabilities

| Member | Responsibility |
|--------|----------------|
| `embedded` | Signal input — hides breadcrumb/title when true |
| `ngOnInit` | Sets breadcrumb: Home → Settings → Security Center |
| Template | 2-column grid (`lg:grid-cols-2`) |

---

## Critical Design Considerations

- **Thin container** — no business logic beyond breadcrumb.
- **Styling split** — standalone `h1` uses `text-gray-900` (light) on dark admin shell—visual mismatch when not embedded in profile card.

---

## Gotchas & Best Practices

- Children always mount—both API calls fire even if user only cares about one panel.
- No tabs within security center—always shows MFA + sessions together.
- Embedded in profile inherits profile dark card; standalone may look inconsistent.

---

## Architectural Advice & Refactoring

**Add:** Dark-theme title styles for standalone route; lazy-load children on visibility. **Correct:** Align Tailwind with KPIT inline theme. **Remove:** Nothing.

---

## Navigation Strategy

Next: `mfa-enrollment.component.ts`, `active-sessions.component.ts`, `profile-settings.component.html` security tab.
