# `log-upload.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/upload/log-upload.component.ts`

---

## Executive Summary

`LogUploadComponent` provides **drag-and-drop CAN log upload** with optional vehicle linking, progress UI, and **status polling** until Python/Kafka pipeline completes. Uses `CanService.uploadLog` and `getUploadStatus`.

**Business value:** Ingest offline logs into MySQL/Kafka pipeline; used in sniffer sidebar and `CanWorkspaceComponent`.

---

## Architectural Process Orchestration

```
User drops .txt/.log/.asc/.blf
        ▼
CanService.uploadLog(file, carUid?)
        ▼
POST /api/logs/upload → sessionId
        ▼
pollStatus: interval 2s × max 30 → getUploadStatus
        ▼
complete → uploadComplete.emit(sessionId)
        ▼
Parent reloads sessions / auto-select
```

---

## Key Controller/Service Capabilities

| Member | Role |
|--------|------|
| `@Input cars`, `carUid` | Vehicle link dropdown |
| `@Output uploadComplete` | sessionId |
| `uploading`, `uploadError`, `uploadStatus` | UI state |
| Drag/drop + file input | Same `upload()` path |

Accepts: `.txt`, `.log`, `.asc`, `.blf`.

---

## Critical Design Considerations

- **Polling cap** — 60s then emits complete anyway (may be premature).
- **Inline template** — Tailwind + custom CSS animations.

---

## Gotchas & Best Practices

- Status endpoint errors during early processing are swallowed (keep polling).
- `carUid` setter only applies if truthy.

---

## Architectural Advice & Refactoring

**Add:** WebSocket or SSE for processing status instead of poll. **Correct:** Fail loudly after max polls without complete.

---

## Navigation Strategy

Next: `can.service.ts` upload methods, Python `file_worker`, `sniffer.component` `onUploadComplete`.
