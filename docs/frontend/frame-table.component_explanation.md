# `frame-table.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/sniffer/frame-table/frame-table.component.ts`

---

## Executive Summary

`FrameTableComponent` is a **presentational CAN frame table**: sticky header, expandable signal sub-rows, fault badges, relative timestamps. Parent passes **pre-filtered** `CanFrame[]`—no HTTP or playback logic here.

**Business value:** Separates rendering from `SnifferComponent`'s filtering/telemetry complexity.

---

## Architectural Process Orchestration

```
SnifferComponent.filteredVisibleFrames()
        ▼
[frames] [sessionStartTs] [faultsByFrameId] [visibleSignalNames]
        ▼
FrameTableComponent renders rows
        ▼
frameClicked output (optional row click)
```

`visibleSignalNames` input documented but expand shows all parsed signals (filter may be parent-side).

---

## Key Controller/Service Capabilities

| Input/Output | Purpose |
|--------------|---------|
| `frames` | Rows to display |
| `sessionStartTs` | Relative time column |
| `faultsByFrameId` | Map for ⚠ tooltip |
| `expandedFrameId` | Local signal expand state |
| `parseSignals()` | JSON parse helper |
| `frameClicked` | Output frame.id |

Exports `ParsedSignal` interface.

---

## Critical Design Considerations

- **Pure presentation** — explicit design comment in source.
- **OnPush** — expand toggles via local signal clone pattern.

---

## Gotchas & Best Practices

- `visibleSignalNames` input unused in template filtering—potential dead input.
- Track by `frame.id`—id 0 for live frames may collide.

---

## Architectural Advice & Refactoring

**Add:** Filter sub-rows by `visibleSignalNames`. **Remove:** Unused input or wire it.

---

## Navigation Strategy

Next: `sniffer.component.ts` `filteredVisibleFrames`, `can.model_explanation.md`.
