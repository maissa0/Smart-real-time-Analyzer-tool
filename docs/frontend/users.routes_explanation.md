# `users.routes.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/users/users.routes.ts`

---

## Executive Summary

`users.routes.ts` exports **`usersRoutes`**: lazy-loaded admin user-management routes under `/admin/users`, defaulting to the user list. The list route is protected by **`adminGuard`**.

**Business value:** Code-splits RBAC user administration; only admins reach the user list.

---

## Architectural Process Orchestration

```
app.routes.ts: path 'users' → loadChildren(usersRoutes)
        ▼
/admin/users → redirect '' → 'list'
        ▼
/admin/users/list → UserListComponent (adminGuard)
        ▼
** → redirect 'list'
```

No nested child routes—detail/edit UX is modal/panel overlays in `UserListComponent`.

---

## Key Controller/Service Capabilities

| Route | Component | Guards |
|-------|-----------|--------|
| `''` | redirect → `list` | — |
| `list` | `UserListComponent` | `adminGuard` |
| `**` | redirect → `list` | — |

---

## Critical Design Considerations

- **Single visible route** — invite, deactivate, detail panel are in-component UI, not URL segments.
- **Guard at route level** — non-admins never load the list chunk.

---

## Gotchas & Best Practices

- Wildcard `**` sends unknown paths back to list—no 404 for `/admin/users/foo`.
- Parent `app.routes` does not repeat `adminGuard`; reliance is on this child route only.

---

## Architectural Advice & Refactoring

**Add:** Optional route `list/:userId` for shareable detail deep links. **Remove:** Nothing.

---

## Navigation Strategy

Next: `user-list.component.ts`, `admin.guard_explanation.md`, `app.routes.ts`.
