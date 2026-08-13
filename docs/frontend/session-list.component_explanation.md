# `session-list.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/session-list/session-list.component.ts`

---

## Executive Summary

`SessionListComponent` is an **extracted session sidebar panel**: loads/paginates sessions, polls every 5s, filters live-only, emits selection. Uses direct HTTP (not always used—`SnifferComponent` also has its own `loadSessions`).

**Business value:** Reusable session list with load-more; intended decomposition of sniffer monolith.

---

## Architectural Process Orchestration

```
ngOnInit → loadSessions + interval(5s)
        ▼
GET /api/can/sessions?page&size OR /api/cars/{id}/sessions
        ▼
filteredSessions (liveOnly filter)
        ▼
click → sessionSelected output
```

---

## Key Controller/Service Capabilities

| Input | Effect |
|-------|--------|
| `liveOnly` | Filter `live_simulation` |
| `carId` | Car-scoped sessions URL |

| Output | `sessionSelected` |

Pagination: page 0, size 20, `hasMore`, `loadMore()`.

---

## Critical Design Considerations

- **Parallel loader** — Sniffer may duplicate session loading logic instead of using this component exclusively.
- Sort: live sessions first, then createdAt DESC.

---

## Gotchas & Best Practices

- Handles both array and `{ content, hasMore }` responses.
- Manual auth headers.

---

## Architectural Advice & Refactoring

**Add:** Single session data source in store; sniffer should delegate here. **Remove:** Duplicate loadSessions in sniffer if this component is primary.

---

## Navigation Strategy

Next: `sniffer.component.ts`, fleet/workspace session lists.
