# `sniffer.routes.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/sniffer.routes.ts`

---

## Executive Summary

`sniffer.routes.ts` exports **`SNIFFER_ROUTES`**: a single lazy-loaded route mapping `/admin/sniffer` to `SnifferComponent`—the main CAN log inspection workspace.

**Business value:** Code-splits the largest frontend feature; mounted under admin layout with `authGuard`.

---

## Architectural Process Orchestration

```
app.routes.ts: path 'sniffer' → loadChildren(SNIFFER_ROUTES)
        ▼
/admin/sniffer → SnifferComponent
        ▼
?sessionId= query param → auto-select session (in component)
```

No child routes—all tabs (table/charts/integrity) are in-component state.

---

## Key Controller/Service Capabilities

| Route | Component |
|-------|-----------|
| `''` | `SnifferComponent` |

---

## Critical Design Considerations

- **Single route** — deep linking uses query params, not route segments.
- **Also embeddable** — `SnifferComponent` used inside `CanWorkspaceComponent` with inputs.

---

## Gotchas & Best Practices

- `/admin/sniffer` vs workspace embed—same component, different chrome (`hideUpload`, `hideSimulator`, external filters).

---

## Architectural Advice & Refactoring

**Add:** Child routes for tab state (`/sniffer/:sessionId/charts`). **Remove:** Nothing.

---

## Navigation Strategy

Next: `sniffer.component.ts`, `app.routes.ts`.
