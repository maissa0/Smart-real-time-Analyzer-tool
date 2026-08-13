# `user-list.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/users/user-list/user-list.component.html`

---

## Executive Summary

The user list template is a **KPIT dark-theme admin page** (~512 lines) with inline styles: header + invite CTA, pending registrations table, main user table with filters/pagination, and four modal overlays plus the detail panel host.

**Business value:** Full admin UX for user lifecycle without separate route segments—all interaction in one view.

---

## Architectural Process Orchestration

```
Page shell (dark bg #07090b)
  ├─ Header + Invite User button
  ├─ @if pendingUsers → registration requests table (approve/reject)
  ├─ Main card: search + status select → userStore.setFilter
  │     ├─ loading / empty / table with pagination
  │     └─ row click → openDetailPanel
  ├─ @if showInviteModal → invite form
  ├─ @if showDeactivateModal → reason textarea
  ├─ @if showDeleteModal → confirm delete
  ├─ @if showDetailPanel → app-user-detail-panel
  └─ @if showRejectModal → reject reason
```

Status badges on rows toggle activate/deactivate with `$event.stopPropagation()` so row click does not fire.

---

## Key Controller/Service Capabilities

| UI block | Bindings / events |
|----------|-------------------|
| Pending table | `pendingUsers()`, `approveUser()`, `openRejectModal()` |
| Filters | `searchValue()`, `onSearchInput()`, `userStore.setFilter({ status })` |
| Main table | `filteredUsers()`, `formatRole()`, `userStore.isLoading()`, pagination via `userStore.setPage` |
| Row actions | Status badge, delete icon, row → detail panel |
| Modals | Invite `inviteForm`, deactivate `deactivateReason`, delete/reject confirms |

Uses Angular `@if` / `@for` control flow throughout.

---

## Critical Design Considerations

- **All styling inline** — no component SCSS file; heavy use of `onmouseover`/`onmouseout` DOM handlers.
- **No reset-password button** — despite TS method existing.
- **Detail panel** — only edit path from list (not `UserEditDrawerComponent`).

---

## Gotchas & Best Practices

- Duplicate breadcrumb vs `BreadcrumbService` in TS.
- Deactivate modal marks reason required in UI but TS does not block empty reason before `confirmDeactivate()` (only button `[disabled]`).
- Pagination shows `filteredUsers().length` vs `totalCount`—current page size may differ from filtered length semantics.

---

## Architectural Advice & Refactoring

**Add:** Extract SCSS partial for KPIT admin tables. **Use:** `app-breadcrumb` instead of inline nav. **Accessibility:** Replace inline hover JS with CSS `:hover`.

---

## Navigation Strategy

Next: `user-list.component_explanation.md`, `user-detail-panel.component_explanation.md`.
