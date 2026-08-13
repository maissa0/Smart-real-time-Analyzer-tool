# `modal.component.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/components/modal/modal.component.ts`

---

## Executive Summary

`ModalComponent` is a **reusable dialog shell**: backdrop, titled header, close button, and `<ng-content>` body. Supports size presets and optional backdrop dismiss.

**Business value:** Standard modal pattern for admin forms—alternative to inline fixed overlays in features.

**Note:** **Unused** in current app; features (user list, sniffer) implement modals with inline `@if` + fixed divs.

---

## Architectural Process Orchestration

```
Parent binds [isOpen] [title] [size] [closeOnBackdrop]
        ▼
@if isOpen → fixed overlay + dialog panel
        ▼
User closes → closed output OR backdrop click
        ▼
Parent sets isOpen false
```

---

## Key Controller/Service Capabilities

| Input / output | Role |
|----------------|------|
| `isOpen` | Required boolean gate |
| `title` | Header text |
| `size` | `sm` \| `md` \| `lg` \| `xl` → max-width classes |
| `closeOnBackdrop` | Default true |
| `closed` | Output on X or backdrop |
| `ng-content` | Modal body slot |

Accessibility: `role="dialog"`, `aria-modal`, `aria-labelledby="modal-title"`.

---

## Critical Design Considerations

- **Light theme** — white panel, gray borders (Tailwind).
- **Backdrop click detection** — checks target class `bg-black/50` (fragile if class changes).
- **OnPush** — parent must update `isOpen` signal/input.

---

## Gotchas & Best Practices

- Backdrop handler may fail if Tailwind compiles different class string.
- No focus trap or Escape key handler.
- Duplicate UX vs 400+ lines of inline modals in `user-list.component.html`.

---

## Architectural Advice & Refactoring

**Migrate:** User invite/deactivate/delete modals to `<app-modal>`. **Add:** `cdkTrapFocus`, Escape listener. **Fix:** Backdrop click via template ref not CSS class name.

---

## Navigation Strategy

Next: `user-list.component.html_explanation.md`, Angular CDK Overlay.
