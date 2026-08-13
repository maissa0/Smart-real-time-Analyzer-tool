# `.gitkeep` — Architecture Explanation

**Source:** `Frontend_angular/src/app/shared/directives/.gitkeep`

---

## Executive Summary

`.gitkeep` is an **empty Git placeholder** so the `shared/directives/` directory is tracked in version control before or between directive files.

**Business value:** Repository hygiene only—no runtime behavior.

---

## Architectural Process Orchestration

```
Git repository
        └── preserves shared/directives/ folder
                └── has-permission.directive.ts (actual directive)
```

Not compiled or bundled by Angular.

---

## Key Controller/Service Capabilities

**None.**

---

## Critical Design Considerations

- Directives are standalone and imported per feature—no NgModule barrel required.
- Folder currently holds one real directive plus this placeholder.

---

## Gotchas & Best Practices

- Do not import in application code.
- Safe to remove once directory always contains tracked `.ts` files.

---

## Architectural Advice & Refactoring

**Add:** `index.ts` re-exporting `HasPermissionDirective` for cleaner imports. **Remove:** `.gitkeep` when folder is permanently populated.

---

## Navigation Strategy

Next: `has-permission.directive_explanation.md`.
