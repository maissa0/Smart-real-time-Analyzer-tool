# `index.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/store/index.ts`

---

## Executive Summary

Barrel file re-exporting **`AuthStore`**, **`UserStore`**, and their state **types** from the app-level signal stores folder.

**Business value:** Single import path for global client state (`from '../store'` or `@app/store` if path alias exists).

---

## Architectural Process Orchestration

```
auth.store.ts  ──┐
                 ├── index.ts re-exports
user.store.ts  ──┘
        ▼
Consumers may import from barrel OR direct file paths
```

**Current adoption:** Features import **direct paths** (`store/auth.store`, `store/user.store`)—barrel is optional and rarely used.

---

## Key Controller/Service Capabilities

| Export | Kind |
|--------|------|
| `AuthStore` | Signal store (singleton) |
| `AuthState` | Type interface |
| `UserStore` | Signal store (singleton) |
| `UserStoreState` | Type interface |

Does not export feature-scoped stores (e.g. `DashboardStore` lives under `features/dashboard/`).

---

## Critical Design Considerations

- **App-level stores only** — CAN/dashboard state stays in feature folders by design.
- **Type + value exports** — enables `import type { AuthState }` tree-shaking.
- **No store registration** — `@ngrx/signals` stores use `providedIn: 'root'` in each file.

---

## Gotchas & Best Practices

- Name collision risk with `data/models/index.ts` if both imported as `from '../index'`—use explicit paths or aliases.
- Adding a third global store requires updating this barrel manually.
- Importing barrel in root `app.config.ts` would not auto-init stores beyond each store's own hooks (`UserStore.onInit`).

---

## Architectural Advice & Refactoring

**Adopt:** Consistent barrel imports across guards, layout, and auth features. **Add:** Re-export note in README or path alias `@app/store`. **Extend:** Only when new root-level stores appear (e.g. `SessionStore`).

---

## Navigation Strategy

Next: `auth.store_explanation.md`, `user.store_explanation.md`, `dashboard.store_explanation.md`.
