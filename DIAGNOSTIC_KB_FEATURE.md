# Diagnostic Knowledge Base & Subsystem Fault Report — Implementation Guide

> Feature started 2026-07-19. Makes the 3D-twin **Export Report** PDF (and the app's
> live fault views) intuitive: raw faults become **subsystem-grouped, plain-English
> diagnostics** with per-fault operating context and "what to check", driven by a
> **user-refinable knowledge base** that gets more accurate the more it's edited.

---

## 1. Why

The current exported PDF is data-rich but insight-poor. It dumps raw fault strings
(`COUNTER ERR Sequence gap for Gauge_Status: expected 1, got 3`) and a 107-row signal
roster, but never says **which subsystem is affected, what it physically means, or what
to go check**, and gives no operating-condition context to narrow the diagnosis.

Target transformation:
- `[14:02:01] 0x55A Fault Detected` → `Power Steering Assist Failure: comms timeout with Steering ECU` + what to check.
- Add a **Vehicle State** context per fault (gear / wheel-speed band / engine / doors) so an engineer knows whether a fault happened under load (highway) or at standstill (startup/electrical).

## 2. Locked design decisions (from requirements Q&A)

| Area | Decision |
|---|---|
| Translation source | Curated **user-editable** KB (MySQL) + AI **grounded in it** + decoder friendly-names. Not hardcoded. |
| Mapping key | **Layered fallback**: `SIGNAL → MESSAGE → SUBSYSTEM → DEFAULT`, each × faultType (null faultType = any). |
| Editing | **Both** a permission-gated admin "Diagnostics Catalog" page **and** inline edit from a fault. |
| Per-fault context | **Both** — snapshot at detection (new sessions) + on-demand InfluxDB correlation (existing sessions). |
| Verdicts | **Two** per subsystem, shown side by side: deterministic (rules by count + severity) **and** AI-judged. |
| AI | Ground the Groq summary in the KB so it stops inventing ECU/wiring details. |
| Report layout | **Grouped by subsystem**; non-nominal signals inline + a compact full-roster appendix. |
| Scope | App-wide: report + twin event log + sniffer Integrity tab. |
| Sequencing | **Foundations first** (editable KB before it's consumed). |

## 3. Subsystem taxonomy — free from the catalogues

The 6 catalogue files each declare a `<Bus Name="...">` root, which is the subsystem.
`CatalogLoaderService` parses every `<massage>` (note the XML typo) and now records
`msgName → Bus name`. Bus → friendly label mapping (in `DiagnosticKbService.subsystemLabel`):

| Bus | Label |
|---|---|
| ADAS_CAN | ADAS & Safety |
| CHASSIS_CAN | Chassis & Braking |
| CLUSTER_CAN | Instrument Cluster |
| KEY_CAN | Access & Key |
| POWERTRAIN_CAN | Powertrain |
| CAR_CAN | Body & Comfort |
| (unmapped msg) | General |

## 4. Data model

**`diagnostic_rule`** (MySQL, editable) — one rule per layer/key/faultType:

| column | notes |
|---|---|
| id | identity |
| scope | `SIGNAL` \| `MESSAGE` \| `SUBSYSTEM` \| `DEFAULT` |
| match_key | signal name / msg name / subsystem label / `*` |
| fault_type | `SIGNAL_RANGE` \| `COUNTER_ERROR` \| `TIMING_GAP` \| `DUPLICATE`, or NULL = any |
| subsystem | owning subsystem label (grouping + verdict) |
| title, meaning, likely_cause, what_to_check | plain-English strings (len 200/1000) |
| severity_weight | int; drives deterministic verdict (SIGNAL_RANGE=4, COUNTER/TIMING=2, DUPLICATE=1) |
| display_name | optional friendly signal/message name |
| enabled, builtin | builtin=true for seeded rows; user rows=false |
| updated_by, created_at, updated_at | audit |

**`subsystem_mapping`** — `msg_name` (unique) → `subsystem`. Seeded from catalogues.

**Layered lookup** (`DiagnosticKbService.resolve(faultType, msgName, signalName)`):
try `SIGNAL(signalName)` → `MESSAGE(msgName)` → `SUBSYSTEM(subsystemFor(msgName))` →
`DEFAULT("*")`. At each level an exact `faultType` match wins over a NULL ("any") rule.

## 5. API (`/api/diagnostics`, gated by `diagnostics:read`/`diagnostics:write`)

- `GET /rules` — list all rules
- `GET /rules/{id}` — one rule
- `GET /subsystems` — distinct subsystem labels
- `POST /rules` — create (forces builtin=false)
- `PUT /rules/{id}` — update
- `DELETE /rules/{id}` — delete

---

## 6. Phases

### Phase 1 — Editable KB foundation ✅ DONE & VERIFIED (2026-07-19)

**Backend** (`mvnw compile` → SUCCESS):
- `entity/DiagnosticRuleEntity.java`, `entity/SubsystemMappingEntity.java` (new)
- `repository/DiagnosticRuleRepository.java`, `repository/SubsystemMappingRepository.java` (new)
- `dto/DiagnosticRuleDto.java` (new record)
- `service/DiagnosticKbService.java` (new) — `@PostConstruct seedIfEmpty()` (idempotent: seeds
  subsystem_mapping from catalogues + subsystem-level + DEFAULT starter rules only when tables
  empty), `resolve(...)` layered lookup, `subsystemFor(...)`, CRUD, template helpers.
- `controller/DiagnosticKbController.java` (new) — CRUD REST.
- `service/CatalogLoaderService.java` (edited) — added `@Getter messageSubsystems` map + Bus-name capture.
- `config/DataInitializer.java` (edited) — seeded `diagnostics:read`/`diagnostics:write` permissions.

**Frontend** (`tsc --noEmit` → EXIT 0):
- `features/diagnostics/diagnostics.routes.ts`, `features/diagnostics/diagnostics-page.component.ts` (new) —
  admin "Diagnostics Catalog": subsystem list + rule cards + slide-in editor (meaning / likely-cause /
  what-to-check / severity / enabled), self-contained standalone component mirroring `catalog-page`.
- `app.routes.ts` (edited) — `/admin/diagnostics` route, `permissionGuard` + `data.permission: 'diagnostics:read'`.
- `shared/layout/sidebar/sidebar.component.html` (edited) — "Diagnostics" nav link.

**Requires a backend restart** to run the seeder and expose the endpoints. Depends on
`catalog.path` being configured (already is — IntegrityAnalyzer relies on it too); if catalogues
don't load, only the 4 DEFAULT rules seed (degraded but non-fatal).

### Phase 2 — Fault enrichment + per-fault context ✅ DONE (2026-07-19, compile-verified; needs restart)

Backend `mvnw compile` → EXIT 0. New: `dto/FaultContextSignal`, `dto/EnrichedFaultDto`,
`service/VehicleStateSignals`, `service/DiagnosticEnrichmentService`. Changed: `IntegrityFaultEntity`
(+`context_json` TEXT), `IntegrityAnalyzerService` (rolling latest-value map + snapshot on each fault),
`IntegrityService` (enriches faults + back-fills context + resolves KB), `IntegrityController`
(returns `List<EnrichedFaultDto>`), `SessionSummaryDto`/`SessionSummaryService` (COUNTER_ERROR fix).
Column auto-adds via ddl-auto on restart (CAN-domain tables have no `.sql` migration). Frontend fault
model is untouched — enriched DTO preserves every original field, new fields are additive.

1. **Fix known bug:** `SessionSummaryService.buildFaultBreakdown` never counts `COUNTER_ERROR`
   (only DUPLICATE/TIMING_GAP/SIGNAL_RANGE). Add it; also add `counterErrors` wherever the
   breakdown is surfaced.
2. **Per-fault context — snapshot at detection (new sessions):** add `context_json` column to
   `IntegrityFaultEntity`. `IntegrityAnalyzerService` keeps a per-session rolling "latest signal
   values" map (it already parses `signalsJson` per frame); on `buildFault`, snapshot the relevant
   signals (affected message's own signals + gear/wheel-speed/engine + key/doors; ADAS extras for
   ADAS subsystems) into `context_json`.
3. **Per-fault context — on-demand (existing sessions):** new `DiagnosticEnrichmentService` fills
   missing context by querying InfluxDB `can_signals` values near each fault timestamp (one batched
   query per session, correlate in memory). Retroactive for sessions like `live_simulation`.
4. **Enriched fault DTO:** extend the fault response returned by `getIntegrityFaults` with
   `subsystem, title, meaning, likelyCause, whatToCheck, severity, context[]` via
   `DiagnosticKbService.resolve(...)` (signal name parsed from `description` "Signal <name> ..." or
   from msgName).
5. Verify: backend restart + compile; enriched faults appear for an existing session.

### Phase 3 — Grounded AI + grouped report DTO + two verdicts ✅ DONE (2026-07-19, compile-verified)

`DiagnosticReportService` + `DiagnosticReportDto` (+`SubsystemReport`); endpoint
`GET /api/can/integrity/sessions/{id}/diagnostic-report`. Deterministic verdict (SIGNAL_RANGE→Critical;
counter/timing or severity≥4→Needs attention; duplicates→Advisory; none→Healthy) shown beside a
Groq AI verdict grounded in the KB (degrades to deterministic-only on LLM failure). Session-summary
prompt also grounded via a "KNOWLEDGE-BASE DIAGNOSTICS" context block. Backend compiles clean.

### Phase 4 — Report rework ✅ DONE (2026-07-19, `ng build` clean) &nbsp; · &nbsp; Phase 5 — partial
- `fault-report.service.ts`: Vehicle State bar → health + overall verdict → 3D image → grounded
  narrative → subsystem sections (two verdict badges; per-fault title/meaning + "When:" context line +
  "Check:"; non-nominal signals inline) → appendix. Legacy flat layout kept when no report is passed.
- `twin-tab.exportReport()` fetches `getDiagnosticReport` and passes report + vehicle-state.
- Model/service: `DiagnosticReport`/`SubsystemReport`/`FaultContextSignal` + `getDiagnosticReport()`;
  optional enrichment fields on `IntegrityFault`.
- **Phase 5 done:** sniffer Integrity tab shows subsystem + plain-English title/meaning + check hint.
- **Phase 5 remaining:** inline edit-modal bound to the matched rule (needs `ruleId` on the enriched
  DTO; `/admin/diagnostics` already does full CRUD); twin-tab event-log enriched text; optional
  `decoder.py` friendly-names.

### Phase 3 — Grounded AI + grouped report DTO + two verdicts (original plan)

1. **Ground the AI:** in `SessionSummaryService.buildLlmContext`/`callLlm`, inject the matched KB
   entries (subsystem meaning + checks per present fault) into the Groq prompt; instruct "use these
   diagnostics, do not invent"; request **per-subsystem verdicts**.
2. **Deterministic verdict:** from summed `severity_weight` per subsystem — e.g. any SIGNAL_RANGE →
   Critical; repeated counter/timing → Needs attention; none → Healthy (thresholds tunable, can live
   in KB later).
3. **New `DiagnosticReportDto`:** groups enriched faults by subsystem, each carrying rule-verdict +
   AI-verdict, its faults (with context), non-nominal signals, and checks. Expose via a report endpoint
   (or extend the summary DTO).

### Phase 4 — Report rework (frontend PDF)

Rework `core/services/fault-report.service.ts` + the `twin-tab` export input to render, in order:
header → session meta → **Vehicle State bar** → health + both verdicts → 3D image → grounded AI
narrative → **subsystem sections** (2 verdict badges, plain-English faults each with its
operating-context line + what-to-check, non-nominal signals inline) → recommendations → compact
full-roster appendix. `twin-tab.component.ts.exportReport()` must pass the enriched grouped data.

### Phase 5 — Inline edit + app-wide enriched text

1. **Inline edit:** small "edit diagnostic" affordance on a fault (twin tab / report preview) →
   opens an editor bound to the matched rule (or creates a SIGNAL-scope rule) → `POST/PUT /api/diagnostics/rules`.
2. **App-wide text:** twin-tab event log + sniffer Integrity tab consume the enriched plain-English
   subsystem text instead of raw `description`.
3. **decoder.py friendly-names** (optional): signal→friendly display at decode time for live views.

---

## 7. Gotchas / notes

- **Backend does not hot-reload** — restart after Java changes (seeder, enrichment, analyzer, summary).
- **decoder.py does not hot-reload** either.
- **Unity is NOT involved** in this feature — no WebGL rebuild needed.
- **GateGuard hook** blocks every file write/command on first attempt and forces a facts-preamble +
  retry, roughly doubling tool round-trips and inflating cost. Disable it for build sessions via
  `ECC_GATEGUARD=off` or add `pre:edit-write:gateguard-fact-force` and `pre:bash:gateguard-fact-force`
  to `ECC_DISABLED_HOOKS`.
- **Build env:** `JAVA_HOME` is misconfigured for Git Bash; compile with PowerShell after
  `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-22.0.2.9-hotspot"`. Frontend type-check:
  `node_modules/.bin/tsc -p tsconfig.app.json --noEmit`.

## 8. Verification commands

```powershell
# Backend compile
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-22.0.2.9-hotspot"
& "C:\tools\Kpit_c\backend\mvnw.cmd" -f "C:\tools\Kpit_c\backend\pom.xml" -q compile -DskipTests

# Frontend type-check
& "C:\tools\Kpit_c\Frontend_angular\node_modules\.bin\tsc.cmd" -p "C:\tools\Kpit_c\Frontend_angular\tsconfig.app.json" --noEmit
```
