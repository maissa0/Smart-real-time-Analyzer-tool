# `user-edit-drawer.component.html` — Architecture Explanation

**Source:** `Frontend_angular/src/app/features/users/user-edit-drawer/user-edit-drawer.component.html`

---

## Executive Summary

This template defines a **fixed right-side drawer** (~135 lines, inline styles) for editing job title and department: backdrop dismiss, header, read-only name/phone, editable fields, and Cancel/Save footer.

**Business value:** Focused admin edit UI with clear “editable vs read-only” sections.

**Note:** Parent component is **not mounted** in the current app—the markup is ready but unused.

---

## Architectural Process Orchestration

```
Fixed overlay (z-index 50)
  ├─ Backdrop click → onClose()
  ├─ Header: title + subtitle + close
  └─ Form (ngSubmit → onSubmit)
        ├─ Avatar + name/email (read-only display)
        ├─ USER INFORMATION: fullName, phone (read-only <p>)
        ├─ EDITABLE BY ADMIN: jobTitle, department inputs
        └─ Footer: Cancel | Save Changes [disabled if saving]
```

---

## Key Controller/Service Capabilities

| Region | Bindings |
|--------|----------|
| Identity | `user().fullName`, `user().email`, avatar initial |
| Read-only | `user().fullName`, `user().phone` |
| Editable | `formControlName` jobTitle, department |
| Actions | `onClose()`, `onSubmit()`, `isSaving()`, `form.invalid` |

KPIT palette: `#0d1117` panel, `#b0ff44` accent on editable section label.

---

## Critical Design Considerations

- **Inline styles only** — matches user-list pattern, not shared SCSS.
- **Max-width 420px** — narrower than detail panel (720px)—suited for quick edits.

---

## Gotchas & Best Practices

- No email field edit (correct for admin scope).
- Phone shown but not editable—ensure backend populates `user.phone`.
- Drawer unused—verify before investing in styling fixes.

---

## Architectural Advice & Refactoring

**Consolidate:** Merge into detail panel or delete. **Extract:** Shared drawer shell component with detail panel. **Add:** `aria` attributes for overlay focus trap if activated.

---

## Navigation Strategy

Next: `user-edit-drawer.component_explanation.md`, `user-detail-panel.component_explanation.md`.
