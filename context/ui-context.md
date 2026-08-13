# UI Context — KPIT Smart Real-Time CAN Analyser

## Theme
Dark only. No light mode. The design language is a dark technical workspace —
near-black backgrounds, layered surfaces, and precise accent colors that carry
domain meaning. Green signals live data, red signals faults and errors, orange
signals anomalies, blue signals navigation and primary actions. The aesthetic
is an engineering dashboard — dense, information-rich, no decorative elements.
Every color choice must be intentional and traceable to a semantic role.

## Colors
All components must use these CSS custom property tokens — no hardcoded hex
values anywhere in the codebase.

| Role                  | CSS Variable          | Value     |
| --------------------- | --------------------- | --------- |
| Page background       | `--bg-base`           | `#07090b` |
| Surface (cards)       | `--bg-surface`        | `#0f1215` |
| Surface elevated      | `--bg-surface-raised` | `#161b20` |
| Primary text          | `--text-primary`      | `#f1f5f9` |
| Muted text            | `--text-muted`        | `#64748b` |
| Disabled text         | `--text-disabled`     | `#334155` |
| Primary accent        | `--accent-primary`    | `#b0ff44` |
| Primary accent hover  | `--accent-primary-hv` | `#c8ff6e` |
| Blue accent           | `--accent-blue`       | `#3b82f6` |
| Border default        | `--border-default`    | `#1e293b` |
| Border subtle         | `--border-subtle`     | `#0f172a` |
| Error / Fault         | `--state-error`       | `#dc2626` |
| Error background      | `--state-error-bg`    | `#1a0a0a` |
| Success / Live        | `--state-success`     | `#16a34a` |
| Success background    | `--state-success-bg`  | `#0a1a0f` |
| Warning / Anomaly     | `--state-warning`     | `#ea580c` |
| Warning background    | `--state-warning-bg`  | `#1a0e05` |
| Complete / Neutral    | `--state-neutral`     | `#475569` |
| Complete background   | `--state-neutral-bg`  | `#0f1520` |

### Semantic Badge Colors
Badges must always use the semantic state tokens — never arbitrary colors.

| Badge type  | Text token          | Background token      |
| ----------- | ------------------- | --------------------- |
| LIVE        | `--state-success`   | `--state-success-bg`  |
| COMPLETE    | `--text-muted`      | `--state-neutral-bg`  |
| FAULT ⚠     | `--state-error`     | `--state-error-bg`    |
| ANOMALY 🔴  | `--state-warning`   | `--state-warning-bg`  |
| PROCESSING  | `--accent-blue`     | `#0a1020`             |

## Typography

| Role            | Font              | CSS Variable    | Tailwind Class        |
| --------------- | ----------------- | --------------- | --------------------- |
| UI text         | Inter             | `--font-sans`   | `font-sans`           |
| Code / mono     | JetBrains Mono    | `--font-mono`   | `font-mono`           |
| Signal labels   | JetBrains Mono    | `--font-mono`   | `font-mono text-xs`   |
| Frame hex data  | JetBrains Mono    | `--font-mono`   | `font-mono text-xs`   |
| Section headers | Inter             | `--font-sans`   | `font-sans font-semibold` |

All CAN-specific data — message IDs, raw bytes, signal values, timestamps —
must render in `font-mono`. Never render technical data in `font-sans`.

## Font Sizes

| Context                      | Tailwind Class  |
| ---------------------------- | --------------- |
| Page title                   | `text-lg`       |
| Section header               | `text-sm font-semibold` |
| Body / table content         | `text-sm`       |
| Muted labels / helper text   | `text-xs`       |
| Badges                       | `text-xs font-medium` |
| Signal values / hex data     | `text-xs font-mono` |
| Pipeline counter numbers     | `text-2xl font-bold font-mono` |

## Border Radius

| Context                     | Tailwind Class  |
| --------------------------- | --------------- |
| Badges / chips / small tags | `rounded-full`  |
| Buttons                     | `rounded-md`    |
| Input fields                | `rounded-md`    |
| Cards / panels / sections   | `rounded-lg`    |
| Modals / overlays           | `rounded-xl`    |
| Charts container            | `rounded-lg`    |
| Sidebar items               | `rounded-md`    |

## Component Library
Tailwind CSS 3.x utility classes only — no external component library.
All shared UI primitives are hand-built and live in
`Frontend_angular/src/app/shared/components/`. Do not install shadcn,
PrimeNG, Angular Material, or any third-party component library. When
adding a new reusable element, build it in shared/components/ first and
import it where needed — never duplicate component markup across features.

## Layout Patterns

- **Workspace layout**: full-viewport split — fixed left panel (session list
  + simulator controls, 280px), scrollable center content (charts + frame
  table + integrity tab), no right sidebar
- **Left panel**: fixed width 280px, `border-r border-[--border-default]`,
  independent scroll, never collapses
- **Top navbar**: fixed height 48px, `border-b border-[--border-default]`,
  contains logo, page title, user avatar, and connection status badge —
  no navigation links in the navbar itself
- **Sidebar navigation**: left-side icon + label list, 220px wide on desktop,
  `border-r border-[--border-default]`, active item highlighted with
  `--accent-primary` left border indicator
- **Cards / panels**: `bg-[--bg-surface] border border-[--border-default]
  rounded-lg p-4` — used for simulator controls, pipeline counter, upload
  panel, catalog detail
- **Modals / overlays**: centered with `backdrop-blur-sm bg-black/50`,
  modal content `bg-[--bg-surface-raised] rounded-xl border
  border-[--border-default]`, max-w-lg by default
- **Tabs** (Frames / Integrity / Export): `border-b border-[--border-default]`
  with active tab indicated by `border-b-2 border-[--accent-primary]
  text-[--text-primary]`, inactive tab `text-[--text-muted]`
- **Tables**: `border border-[--border-default] rounded-lg` container,
  `text-xs font-mono` for data cells, `text-xs text-[--text-muted]`
  for headers, alternating row backgrounds using `--bg-surface` and
  `--bg-surface-raised`
- **Inline panels** (upload, log import): slide in below the trigger button
  within the workspace — never navigate to a separate page for actions
  that belong in context
- **Pipeline counter**: horizontal 4-step flow with arrow connectors,
  large monospace numbers, label below each step, centered in its card

## Chart Styling
- Background: transparent — inherits `--bg-surface`
- Grid lines: `--border-subtle` at 30% opacity
- Axis labels: `--text-muted`, `font-mono`, `text-xs`
- Step-line rendering only — no smooth curves for CAN signal data
- Signal color assignment: deterministic by signal index — never random
- Legend: signal name in `font-mono text-xs`, colored dot matching line
- Tooltip: `bg-[--bg-surface-raised] border border-[--border-default]
  rounded-md text-xs font-mono`
- Replay progress indicator: thin `--accent-primary` vertical line
  overlaid on the chart at the current playback position

## Icons
Lucide Angular (`lucide-angular`). Stroke-based icons only — no filled
icon variants. Never use emoji as functional icons.

| Context                    | Size class    |
| -------------------------- | ------------- |
| Inline text / table cells  | `h-3 w-3`     |
| Sidebar navigation items   | `h-4 w-4`     |
| Buttons                    | `h-4 w-4`     |
| Status indicators          | `h-4 w-4`     |
| Page-level empty states    | `h-8 w-8`     |

Recommended icons by context:
- Session LIVE: `circle` with `--state-success` fill pulse animation
- Session COMPLETE: `check-circle` in `--text-muted`
- Fault ⚠: `alert-triangle` in `--state-error`
- Anomaly: `activity` in `--state-warning`
- Upload: `upload-cloud`
- Play / Replay: `play`, `pause`, `skip-back`
- Catalog: `file-code`
- Fleet / Vehicle: `car`
- Delete: `trash-2`
- Reload: `refresh-cw`
- Export CSV: `download`
- Filter: `sliders-horizontal`
- Pipeline / Kafka: `zap`
- WebSocket connected: `radio`
- WebSocket disconnected: `wifi-off`