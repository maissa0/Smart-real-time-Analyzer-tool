# Codebase Documentation Audit — Index

Systematic per-file architecture documentation for the KPIT CAN Analyser monorepo.

## Workflow (locked)

For **each source file**:

1. One Markdown explanation: `{original_file_name}_explanation.md`
2. Saved under `docs/` (stack subfolders: `frontend/`, `backend/`, `python/`)
3. Structure: Executive Summary → Orchestration → Capabilities → Design → Gotchas → Refactoring → Navigation

## Audit progress

| Stack | Folder audited | Files documented | Status |
|-------|----------------|------------------|--------|
| Frontend | `src/app/` (pilot) | 5 | Done |
| Frontend | `src/app/core/auth/` | 4 | Done |
| Frontend | `src/app/core/config/` | 1 | Done |
| Frontend | `src/app/core/interceptors/` | 1 | Done |
| Frontend | `src/app/core/services/` | 14 | Done |
| Frontend | `src/app/data/models/` | 7 | Done |
| Frontend | `src/app/data/types/` | 2 | Done |
| Frontend | `src/app/features/analyser/` | 1 | Done |
| Frontend | `src/app/features/auth/code-verification/` | 2 | Done |
| Frontend | `src/app/features/auth/forgot-password/` | 2 | Done |
| Frontend | `src/app/features/auth/login/` | 2 | Done |
| Frontend | `src/app/features/auth/mfa-verify/` | 1 | Done |
| Frontend | `src/app/features/auth/reset-password/` | 2 | Done |
| Frontend | `src/app/features/auth/set-password/` | 1 | Done |
| Frontend | `src/app/features/auth/sign-up/` | 2 | Done |
| Frontend | `src/app/features/auth/auth.routes.ts` | 1 | Done |
| Frontend | `src/app/features/catalogs/` | 1 | Done |
| Frontend | `src/app/features/dashboard/fault-donut-chart/` | 1 | Done |
| Frontend | `src/app/features/dashboard/kpi-card/` | 1 | Done |
| Frontend | `src/app/features/dashboard/message-frequency-chart/` | 1 | Done |
| Frontend | `src/app/features/dashboard/` (component + store) | 2 | Done |
| Frontend | `src/app/features/fleet/` | 1 | Done |
| Frontend | `src/app/features/profile/` | 3 | Done |
| Frontend | `src/app/features/settings/` | 8 | Done |
| Frontend | `src/app/features/sniffer/` | 12 | Done |
| Frontend | `src/app/features/users/` | 6 | Done |
| Frontend | `src/app/layouts/` | 2 | Done |
| Frontend | `src/app/shared/components/` | 10 | Done |
| Frontend | `src/app/shared/directives/` | 2 | Done |
| Frontend | `src/app/shared/layout/` | 6 | Done |
| Frontend | `src/app/store/` | 3 | Done |
| Frontend | `src/app/` (shell: app.component, app.routes, app.config) | 3 | Done |
| Backend | — | 0 | Pending |
| Python | — | 0 | Pending |

## Pilot batch (Angular shell + RBAC)

| Source file | Explanation doc |
|-------------|-----------------|
| `app.component.ts` | [frontend/app.component_explanation.md](./frontend/app.component_explanation.md) |
| `store/auth.store.ts` | [frontend/auth.store_explanation.md](./frontend/auth.store_explanation.md) |
| `store/user.store.ts` | [frontend/user.store_explanation.md](./frontend/user.store_explanation.md) |
| `shared/directives/has-permission.directive.ts` | [frontend/has-permission.directive_explanation.md](./frontend/has-permission.directive_explanation.md) |
| `shared/components/breadcrumb/breadcrumb.component.ts` | [frontend/breadcrumb.component_explanation.md](./frontend/breadcrumb.component_explanation.md) |

### Batch 2 — `core/auth/`

| Source file | Explanation doc |
|-------------|-----------------|
| `core/auth/auth.guard.ts` | [frontend/auth.guard_explanation.md](./frontend/auth.guard_explanation.md) |
| `core/auth/admin.guard.ts` | [frontend/admin.guard_explanation.md](./frontend/admin.guard_explanation.md) |
| `core/auth/permission.guard.ts` | [frontend/permission.guard_explanation.md](./frontend/permission.guard_explanation.md) |
| `core/auth/.gitkeep` | [frontend/.gitkeep_explanation.md](./frontend/.gitkeep_explanation.md) |

### Batch 3 — `core/config/`

| Source file | Explanation doc |
|-------------|-----------------|
| `core/config/api.config.ts` | [frontend/api.config_explanation.md](./frontend/api.config_explanation.md) |

### Batch 4 — `core/interceptors/`

| Source file | Explanation doc |
|-------------|-----------------|
| `core/interceptors/error.interceptor.ts` | [frontend/error.interceptor_explanation.md](./frontend/error.interceptor_explanation.md) |

### Batch 5 — `core/services/`

| Source file | Explanation doc |
|-------------|-----------------|
| `core/services/audit.service.ts` | [frontend/audit.service_explanation.md](./frontend/audit.service_explanation.md) |
| `core/services/auth.service.ts` | [frontend/auth.service_explanation.md](./frontend/auth.service_explanation.md) |
| `core/services/breadcrumb.service.ts` | [frontend/breadcrumb.service_explanation.md](./frontend/breadcrumb.service_explanation.md) |
| `core/services/can.service.ts` | [frontend/can.service_explanation.md](./frontend/can.service_explanation.md) |
| `core/services/live-telemetry.service.ts` | [frontend/live-telemetry.service_explanation.md](./frontend/live-telemetry.service_explanation.md) |
| `core/services/mfa-state.service.ts` | [frontend/mfa-state.service_explanation.md](./frontend/mfa-state.service_explanation.md) |
| `core/services/profile.service.ts` | [frontend/profile.service_explanation.md](./frontend/profile.service_explanation.md) |
| `core/services/replay-engine.service.ts` | [frontend/replay-engine.service_explanation.md](./frontend/replay-engine.service_explanation.md) |
| `core/services/sidebar-state.service.ts` | [frontend/sidebar-state.service_explanation.md](./frontend/sidebar-state.service_explanation.md) |
| `core/services/simulator-state.service.ts` | [frontend/simulator-state.service_explanation.md](./frontend/simulator-state.service_explanation.md) |
| `core/services/telemetry.service.ts` | [frontend/telemetry.service_explanation.md](./frontend/telemetry.service_explanation.md) |
| `core/services/toast.service.ts` | [frontend/toast.service_explanation.md](./frontend/toast.service_explanation.md) |
| `core/services/user.service.ts` | [frontend/user.service_explanation.md](./frontend/user.service_explanation.md) |
| `core/services/.gitkeep` | [frontend/core-services-gitkeep_explanation.md](./frontend/core-services-gitkeep_explanation.md) |

### Batch 6 — `data/models/`

| Source file | Explanation doc |
|-------------|-----------------|
| `data/models/index.ts` | [frontend/index_explanation.md](./frontend/index_explanation.md) |
| `data/models/auth.model.ts` | [frontend/auth.model_explanation.md](./frontend/auth.model_explanation.md) |
| `data/models/user.model.ts` | [frontend/user.model_explanation.md](./frontend/user.model_explanation.md) |
| `data/models/role.model.ts` | [frontend/role.model_explanation.md](./frontend/role.model_explanation.md) |
| `data/models/permission.model.ts` | [frontend/permission.model_explanation.md](./frontend/permission.model_explanation.md) |
| `data/models/audit-log.model.ts` | [frontend/audit-log.model_explanation.md](./frontend/audit-log.model_explanation.md) |
| `data/models/can.model.ts` | [frontend/can.model_explanation.md](./frontend/can.model_explanation.md) |

### Batch 7 — `data/types/`

| Source file | Explanation doc |
|-------------|-----------------|
| `data/types/api.types.ts` | [frontend/api.types_explanation.md](./frontend/api.types_explanation.md) |
| `data/types/filter.types.ts` | [frontend/filter.types_explanation.md](./frontend/filter.types_explanation.md) |

### Batch 8 — `features/analyser/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/analyser/can-workspace.component.ts` | [frontend/can-workspace.component_explanation.md](./frontend/can-workspace.component_explanation.md) |

### Batch 9 — `features/auth/code-verification/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/auth/code-verification/code-verification.component.ts` | [frontend/code-verification.component_explanation.md](./frontend/code-verification.component_explanation.md) |
| `features/auth/code-verification/code-verification.component.html` | [frontend/code-verification.component.html_explanation.md](./frontend/code-verification.component.html_explanation.md) |

### Batch 10 — `features/auth/forgot-password/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/auth/forgot-password/forgot-password.component.ts` | [frontend/forgot-password.component_explanation.md](./frontend/forgot-password.component_explanation.md) |
| `features/auth/forgot-password/forgot-password.component.html` | [frontend/forgot-password.component.html_explanation.md](./frontend/forgot-password.component.html_explanation.md) |

### Batch 11 — `features/auth/login/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/auth/login/login.component.ts` | [frontend/login.component_explanation.md](./frontend/login.component_explanation.md) |
| `features/auth/login/login.component.html` | [frontend/login.component.html_explanation.md](./frontend/login.component.html_explanation.md) |

### Batch 12 — `features/auth/mfa-verify/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/auth/mfa-verify/mfa-verify.component.ts` | [frontend/mfa-verify.component_explanation.md](./frontend/mfa-verify.component_explanation.md) |

### Batch 13 — `features/auth/reset-password/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/auth/reset-password/reset-password.component.ts` | [frontend/reset-password.component_explanation.md](./frontend/reset-password.component_explanation.md) |
| `features/auth/reset-password/reset-password.component.html` | [frontend/reset-password.component.html_explanation.md](./frontend/reset-password.component.html_explanation.md) |

### Batch 14 — `features/auth/set-password/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/auth/set-password/set-password.component.ts` | [frontend/set-password.component_explanation.md](./frontend/set-password.component_explanation.md) |

### Batch 15 — `features/auth/sign-up/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/auth/sign-up/sign-up.component.ts` | [frontend/sign-up.component_explanation.md](./frontend/sign-up.component_explanation.md) |
| `features/auth/sign-up/sign-up.component.html` | [frontend/sign-up.component.html_explanation.md](./frontend/sign-up.component.html_explanation.md) |

### Batch 16 — `features/auth/auth.routes.ts`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/auth/auth.routes.ts` | [frontend/auth.routes_explanation.md](./frontend/auth.routes_explanation.md) |

### Batch 17 — `features/catalogs/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/catalogs/catalog-page.component.ts` | [frontend/catalog-page.component_explanation.md](./frontend/catalog-page.component_explanation.md) |

### Batch 18 — `features/dashboard/fault-donut-chart/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/dashboard/fault-donut-chart/fault-donut-chart.component.ts` | [frontend/fault-donut-chart.component_explanation.md](./frontend/fault-donut-chart.component_explanation.md) |

### Batch 19 — `features/dashboard/kpi-card/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/dashboard/kpi-card/kpi-card.component.ts` | [frontend/kpi-card.component_explanation.md](./frontend/kpi-card.component_explanation.md) |

### Batch 20 — `features/dashboard/message-frequency-chart/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/dashboard/message-frequency-chart/message-frequency-chart.component.ts` | [frontend/message-frequency-chart.component_explanation.md](./frontend/message-frequency-chart.component_explanation.md) |

### Batch 21 — `features/dashboard/` (component + store)

| Source file | Explanation doc |
|-------------|-----------------|
| `features/dashboard/dashboard.component.ts` | [frontend/dashboard.component_explanation.md](./frontend/dashboard.component_explanation.md) |
| `features/dashboard/dashboard.store.ts` | [frontend/dashboard.store_explanation.md](./frontend/dashboard.store_explanation.md) |

### Batch 22 — `features/fleet/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/fleet/fleet-page.component.ts` | [frontend/fleet-page.component_explanation.md](./frontend/fleet-page.component_explanation.md) |

### Batch 23 — `features/profile/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/profile/profile.routes.ts` | [frontend/profile.routes_explanation.md](./frontend/profile.routes_explanation.md) |
| `features/profile/profile-settings/profile-settings.component.ts` | [frontend/profile-settings.component_explanation.md](./frontend/profile-settings.component_explanation.md) |
| `features/profile/profile-settings/profile-settings.component.html` | [frontend/profile-settings.component.html_explanation.md](./frontend/profile-settings.component.html_explanation.md) |

### Batch 24 — `features/settings/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/settings/settings.routes.ts` | [frontend/settings.routes_explanation.md](./frontend/settings.routes_explanation.md) |
| `features/settings/audit-log/audit-log.component.ts` | [frontend/audit-log.component_explanation.md](./frontend/audit-log.component_explanation.md) |
| `features/settings/audit-log/audit-log.component.html` | [frontend/audit-log.component.html_explanation.md](./frontend/audit-log.component.html_explanation.md) |
| `features/settings/security-center/security-center.component.ts` | [frontend/security-center.component_explanation.md](./frontend/security-center.component_explanation.md) |
| `features/settings/security-center/active-sessions/active-sessions.component.ts` | [frontend/active-sessions.component_explanation.md](./frontend/active-sessions.component_explanation.md) |
| `features/settings/security-center/active-sessions/active-sessions.component.html` | [frontend/active-sessions.component.html_explanation.md](./frontend/active-sessions.component.html_explanation.md) |
| `features/settings/security-center/mfa-enrollment/mfa-enrollment.component.ts` | [frontend/mfa-enrollment.component_explanation.md](./frontend/mfa-enrollment.component_explanation.md) |
| `features/settings/security-center/mfa-enrollment/mfa-enrollment.component.html` | [frontend/mfa-enrollment.component.html_explanation.md](./frontend/mfa-enrollment.component.html_explanation.md) |

### Batch 25 — `features/sniffer/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/sniffer/sniffer.routes.ts` | [frontend/sniffer.routes_explanation.md](./frontend/sniffer.routes_explanation.md) |
| `features/sniffer/sniffer.component.ts` | [frontend/sniffer.component_explanation.md](./frontend/sniffer.component_explanation.md) |
| `features/sniffer/sniffer.component.html` | [frontend/sniffer.component.html_explanation.md](./frontend/sniffer.component.html_explanation.md) |
| `features/sniffer/sniffer.component.scss` | [frontend/sniffer.component.scss_explanation.md](./frontend/sniffer.component.scss_explanation.md) |
| `features/sniffer/session-list/session-list.component.ts` | [frontend/session-list.component_explanation.md](./frontend/session-list.component_explanation.md) |
| `features/sniffer/frame-table/frame-table.component.ts` | [frontend/frame-table.component_explanation.md](./frontend/frame-table.component_explanation.md) |
| `features/sniffer/signal-chart/signal-chart.component.ts` | [frontend/signal-chart.component_explanation.md](./frontend/signal-chart.component_explanation.md) |
| `features/sniffer/signal-chart/index.ts` | [frontend/signal-chart.index_explanation.md](./frontend/signal-chart.index_explanation.md) |
| `features/sniffer/replay-bar/replay-bar.component.ts` | [frontend/replay-bar.component_explanation.md](./frontend/replay-bar.component_explanation.md) |
| `features/sniffer/live-pipeline/live-pipeline.component.ts` | [frontend/live-pipeline.component_explanation.md](./frontend/live-pipeline.component_explanation.md) |
| `features/sniffer/upload/log-upload.component.ts` | [frontend/log-upload.component_explanation.md](./frontend/log-upload.component_explanation.md) |
| `features/sniffer/simulator/simulator-control.component.ts` | [frontend/simulator-control.component_explanation.md](./frontend/simulator-control.component_explanation.md) |

### Batch 26 — `features/users/`

| Source file | Explanation doc |
|-------------|-----------------|
| `features/users/users.routes.ts` | [frontend/users.routes_explanation.md](./frontend/users.routes_explanation.md) |
| `features/users/user-list/user-list.component.ts` | [frontend/user-list.component_explanation.md](./frontend/user-list.component_explanation.md) |
| `features/users/user-list/user-list.component.html` | [frontend/user-list.component.html_explanation.md](./frontend/user-list.component.html_explanation.md) |
| `features/users/user-detail-panel/user-detail-panel.component.ts` | [frontend/user-detail-panel.component_explanation.md](./frontend/user-detail-panel.component_explanation.md) |
| `features/users/user-edit-drawer/user-edit-drawer.component.ts` | [frontend/user-edit-drawer.component_explanation.md](./frontend/user-edit-drawer.component_explanation.md) |
| `features/users/user-edit-drawer/user-edit-drawer.component.html` | [frontend/user-edit-drawer.component.html_explanation.md](./frontend/user-edit-drawer.component.html_explanation.md) |

### Batch 27 — `layouts/`

| Source file | Explanation doc |
|-------------|-----------------|
| `layouts/admin-layout/admin-layout.component.ts` | [frontend/admin-layout.component_explanation.md](./frontend/admin-layout.component_explanation.md) |
| `layouts/admin-layout/admin-layout.component.scss` | [frontend/admin-layout.component.scss_explanation.md](./frontend/admin-layout.component.scss_explanation.md) |

### Batch 28 — `shared/components/`

| Source file | Explanation doc |
|-------------|-----------------|
| `shared/components/.gitkeep` | [frontend/shared-components-gitkeep_explanation.md](./frontend/shared-components-gitkeep_explanation.md) |
| `shared/components/breadcrumb/breadcrumb.component.ts` | [frontend/breadcrumb.component_explanation.md](./frontend/breadcrumb.component_explanation.md) |
| `shared/components/data-table/data-table-column.interface.ts` | [frontend/data-table-column.interface_explanation.md](./frontend/data-table-column.interface_explanation.md) |
| `shared/components/data-table/data-table.component.ts` | [frontend/data-table.component_explanation.md](./frontend/data-table.component_explanation.md) |
| `shared/components/data-table/data-table.component.html` | [frontend/data-table.component.html_explanation.md](./frontend/data-table.component.html_explanation.md) |
| `shared/components/data-table/index.ts` | [frontend/data-table.index_explanation.md](./frontend/data-table.index_explanation.md) |
| `shared/components/modal/modal.component.ts` | [frontend/modal.component_explanation.md](./frontend/modal.component_explanation.md) |
| `shared/components/skeleton/skeleton.component.ts` | [frontend/skeleton.component_explanation.md](./frontend/skeleton.component_explanation.md) |
| `shared/components/skeleton/table-skeleton.component.ts` | [frontend/table-skeleton.component_explanation.md](./frontend/table-skeleton.component_explanation.md) |
| `shared/components/toast/toast.component.ts` | [frontend/toast.component_explanation.md](./frontend/toast.component_explanation.md) |

### Batch 29 — `shared/directives/`

| Source file | Explanation doc |
|-------------|-----------------|
| `shared/directives/.gitkeep` | [frontend/shared-directives-gitkeep_explanation.md](./frontend/shared-directives-gitkeep_explanation.md) |
| `shared/directives/has-permission.directive.ts` | [frontend/has-permission.directive_explanation.md](./frontend/has-permission.directive_explanation.md) |

### Batch 30 — `shared/layout/`

| Source file | Explanation doc |
|-------------|-----------------|
| `shared/layout/navbar/navbar.component.ts` | [frontend/navbar.component_explanation.md](./frontend/navbar.component_explanation.md) |
| `shared/layout/navbar/navbar.component.html` | [frontend/navbar.component.html_explanation.md](./frontend/navbar.component.html_explanation.md) |
| `shared/layout/navbar/navbar.component.scss` | [frontend/navbar.component.scss_explanation.md](./frontend/navbar.component.scss_explanation.md) |
| `shared/layout/sidebar/sidebar.component.ts` | [frontend/sidebar.component_explanation.md](./frontend/sidebar.component_explanation.md) |
| `shared/layout/sidebar/sidebar.component.html` | [frontend/sidebar.component.html_explanation.md](./frontend/sidebar.component.html_explanation.md) |
| `shared/layout/sidebar/sidebar.component.scss` | [frontend/sidebar.component.scss_explanation.md](./frontend/sidebar.component.scss_explanation.md) |

### Batch 31 — `store/`

| Source file | Explanation doc |
|-------------|-----------------|
| `store/index.ts` | [frontend/store.index_explanation.md](./frontend/store.index_explanation.md) |
| `store/auth.store.ts` | [frontend/auth.store_explanation.md](./frontend/auth.store_explanation.md) |
| `store/user.store.ts` | [frontend/user.store_explanation.md](./frontend/user.store_explanation.md) |

### Batch 32 — `src/app/` (application shell)

| Source file | Explanation doc |
|-------------|-----------------|
| `app.component.ts` | [frontend/app.component_explanation.md](./frontend/app.component_explanation.md) |
| `app.routes.ts` | [frontend/app.routes_explanation.md](./frontend/app.routes_explanation.md) |
| `app.config.ts` | [frontend/app.config_explanation.md](./frontend/app.config_explanation.md) |

## Recommended audit order (architectural thread)

1. **Frontend auth spine:** `app.config.ts` → `auth.guard.ts` → `auth.service.ts` → `auth.store.ts` → `has-permission.directive.ts`
2. **CAN data plane:** `can.service.ts` → `live-telemetry.service.ts` → `sniffer.component.ts`
3. **Backend ingress:** `CanKafkaConsumer.java` → `CanSessionService.java` → `CanController.java`
4. **Python pipeline:** `decoder.py` → `can_simulator.py` → `file_worker.py`

Tell the assistant which folder to audit next for the next batch.
