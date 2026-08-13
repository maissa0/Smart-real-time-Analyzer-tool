# Diagnostic Knowledge Base — End‑to‑End Testing Guide (A → Z)

How to verify the whole Diagnostic KB feature (Phases 1–5): editable KB → per‑fault
enrichment + context → grouped report with two verdicts → reworked PDF → app‑wide
enriched text + inline edit.

> **Design reference:** `DIAGNOSTIC_KB_FEATURE.md`. **What shipped:** `context/progress-tracker.md`.

---

## 0. What you are testing

| Phase | You should see |
|---|---|
| 1 | A seeded KB (`diagnostic_rule`, `subsystem_mapping`) + an admin **Diagnostics Catalog** page with CRUD. |
| 2 | `GET .../faults` returns **enriched** faults (subsystem, title, meaning, likely cause, what‑to‑check, severity, **context**). New sessions snapshot context at detection; old sessions get it back‑filled from InfluxDB. The `COUNTER_ERROR` breakdown bug is fixed. |
| 3 | `GET .../diagnostic-report` returns faults **grouped by subsystem**, each with a **deterministic** verdict and an **AI** verdict grounded in the KB. |
| 4 | The 3D‑twin **Export Report** PDF leads with a Vehicle‑State bar, overall verdict, and plain‑English **subsystem sections** (two verdict badges, per‑fault meaning + operating context + what‑to‑check). |
| 5 | The sniffer **Integrity tab** shows subsystem + plain‑English text; a permission‑gated **✎ edit** button opens an inline editor bound to the fault's rule. |

---

## 1. Prerequisites (must do first)

1. **Infra up:** MySQL, InfluxDB, Kafka + Zookeeper, and the Python venv
   (`python_parser/.venv`) — the same stack every session needs.
2. **Restart the backend** (it does **not** hot‑reload, and `ddl-auto=update` adds the new
   `integrity_faults.context_json` column on boot):
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-22.0.2.9-hotspot"
   cd C:\tools\Kpit_c\backend
   .\mvnw.cmd spring-boot:run
   ```
   On startup, confirm in the log:
   - `Seeded N subsystem mappings from catalogues` **and** `Seeded N default diagnostic rules`
     (only on the *first* boot after Phase 1 — idempotent afterwards).
   - No errors mentioning `context_json` / `diagnostic_rule` / `subsystem_mapping`.
3. **Frontend:**
   ```powershell
   cd C:\tools\Kpit_c\Frontend_angular
   npm start   # ng serve → http://localhost:4200
   ```
4. **Log in** as an **admin** (or a user holding `diagnostics:read` + `diagnostics:write`) —
   the admin Diagnostics page and the inline ✎ editor are permission‑gated.
5. **(For raw API tests)** grab a bearer token: open DevTools → Network on any API call and
   copy the `Authorization: Bearer …` header. Export it for the curl snippets below:
   ```bash
   TOKEN="Bearer eyJhbGci..."      # from the browser
   BASE="http://localhost:8080/api"
   ```

---

## 2. Test data

Two logs at the repo root:

| File | Purpose |
|---|---|
| `test_3d_twin_session.log` | Rich, **fault‑free** session — best for the 3D twin and a full signal roster. |
| `test_diagnostic_faults.log` | **Purpose‑built to trigger faults across three subsystems** — use this for everything diagnostic. |

### Expected faults from `test_diagnostic_faults.log`

| Time | Msg | Bus → Subsystem | Fault | Why |
|---|---|---|---|---|
| ~2.10s | `0x200` | Chassis & Braking | **DUPLICATE** | Identical frame 0.5 ms after the previous. |
| ~3.30s | `0x102` | Powertrain | **DUPLICATE** | Identical frame 0.4 ms apart. |
| 5.00s | `0x2FC` | Body & Comfort | **SIGNAL_RANGE** | `door_latche_status = 5` — not in the valid set {1,2,3,4,6}. |
| 6.00s | `0x2FC` | Body & Comfort | **DUPLICATE** | Identical frame 0.5 ms apart. |
| 6.0→22.0s | `0x2FC` | Body & Comfort | **TIMING_GAP** | ~16 s gap > 3 × the 5000 ms cycle. |

Resulting **report verdicts**: Body & Comfort → **Critical** (has a SIGNAL_RANGE);
Chassis & Braking → **Advisory**; Powertrain → **Advisory**.

> `COUNTER_ERROR` can't be forced from a clean log (the producer assigns contiguous
> sequence numbers) — it only fires when frames are genuinely dropped/reordered on the bus.
> To exercise the COUNTER_ERROR path, test against a real/live session that produced one, or
> temporarily drop a frame in the pipeline.

---

## 3. Ingest the test data → get a `sessionId`

Ingest goes through the backend, which publishes a Kafka job that the **already-running**
`file_worker.py` + `decoder.py` consumers process (there is no standalone `pipeline.py`). Use the
**Log Upload page**, the embedded Simulator control, or the upload API directly:

```bash
curl -s -X POST "$BASE/logs/upload" -H "Authorization: $TOKEN" \
  -F "file=@C:/tools/Kpit_c/test_diagnostic_faults.log"
# → {"sessionId":"...","filename":"test_diagnostic_faults.log","status":"PROCESSING"}
```

Prerequisite: the Python consumers must be running (`file_worker.py --kafka localhost:9092
--catalogues ./catalogues --uploads-dir ../uploads` and `decoder.py --catalogues ./catalogues
--kafka localhost:9092`), plus Kafka + InfluxDB + MySQL.

Then, in the app, open **Workspace → the new session**. Note its `sessionId` (visible in the
URL `/admin/workspace/session/<sessionId>` and in API responses). **Wait** for processing to
finish (frame count > 0) before running the checks.

Quick sanity check that faults landed:
```bash
curl -s -H "Authorization: $TOKEN" "$BASE/can/integrity/sessions/<sessionId>/summary"
# expect totalFaults ≥ 5, and counterErrors: 0, duplicates: 3, signalRangeViolations: 1, timingGaps: 1
```

---

## 4. Phase 1 — Editable KB foundation

1. **Seeding (API):**
   ```bash
   curl -s -H "Authorization: $TOKEN" "$BASE/diagnostics/rules" | jq 'length'         # > 0
   curl -s -H "Authorization: $TOKEN" "$BASE/diagnostics/subsystems" | jq             # ["ADAS & Safety", "Body & Comfort", ...]
   ```
2. **Admin page:** go to **`/admin/diagnostics`** ("Diagnostics" in the sidebar). Confirm:
   - Left list shows the subsystems from the catalogues.
   - Selecting one shows its rule cards; the slide‑in editor edits meaning / likely‑cause /
     what‑to‑check / severity / enabled.
   - **Create / edit / delete** a rule and confirm it persists after a reload.
3. **Permission gate:** log in as a user **without** `diagnostics:read` → `/admin/diagnostics`
   should redirect to `/admin`.

---

## 5. Phase 2 — Enrichment + per‑fault context

```bash
curl -s -H "Authorization: $TOKEN" "$BASE/can/integrity/sessions/<sessionId>/faults" | jq '.[0]'
```
Check each fault object has, **in addition** to the original fields (`id`, `msgId`, `msgName`,
`faultType`, `description`, `frameTimestamp`):

- `subsystem` — e.g. `"Body & Comfort"` for the `0x2FC` faults.
- `title`, `meaning`, `likelyCause`, `whatToCheck` — plain‑English strings.
- `severity` — 4 for SIGNAL_RANGE, 2 for COUNTER/TIMING, 1 for DUPLICATE.
- `context` — a non‑empty array of `{name, value, label}` (the vehicle state at the fault:
  door signals from `0x2FC`, plus any gear/speed/engine/key present in the session).
- `ruleId` — the resolved rule's id (used by the inline editor).
- `signalName` — set for the SIGNAL_RANGE fault (`"door_latche_status"`), null otherwise.

**COUNTER_ERROR breakdown fix** — confirm the field exists and is separate from the others:
```bash
curl -s -H "Authorization: $TOKEN" "$BASE/can/integrity/sessions/<sessionId>/summary" \
  | jq '{duplicates,timingGaps,signalRangeViolations,counterErrors}'
```

**Snapshot‑at‑detection vs. back‑fill:**
- The `test_diagnostic_faults.log` session is **new**, so `context` was snapshotted live at
  detection.
- To test **on‑demand back‑fill**, pick an **older** session whose faults predate this feature
  (e.g. `live_simulation`): the *first* `/faults` call runs one InfluxDB query, fills
  `context`, and **persists** it. Verify the DB row now has it:
  ```sql
  SELECT fault_type, LEFT(context_json,80) FROM integrity_faults
  WHERE session_id='<oldSessionId>' AND context_json IS NOT NULL LIMIT 5;
  ```
  A second `/faults` call returns the same context without re‑querying InfluxDB.

---

## 6. Phase 3 — Grouped report + two verdicts + grounded AI

```bash
curl -s -H "Authorization: $TOKEN" "$BASE/can/integrity/sessions/<sessionId>/diagnostic-report" | jq
```
Verify:
- `overallVerdict` = **"Critical"** (Body & Comfort has a SIGNAL_RANGE).
- `subsystems[]` grouped and ordered worst‑first, each with:
  - `ruleVerdict` — Body & Comfort **Critical**, Chassis/Powertrain **Advisory**.
  - `aiVerdict` — a one‑sentence plain‑English verdict **grounded in the KB text** (should
    reference the meaning/checks, not invent ECU part numbers). *If Groq is unreachable/no
    API key, `aiVerdict` is `null` and the deterministic verdict still shows — that's the
    intended graceful degradation.*
  - `faults[]` (enriched), `checks[]` (distinct what‑to‑check), `implicatedSignals[]`
    (`["door_latche_status"]` for Body & Comfort).

**Grounded session summary:** generate the AI summary (Report tab → Generate, or
`POST .../summary/generate`) and read `faultAnalysis` — it should explain the fault types
using the KB meaning/checks and **not** invent wiring/ECU details.

---

## 7. Phase 4 — Reworked PDF report

1. Open the session → **3D TWIN** tab. Wait until Unity shows `ready`.
2. Click **⤓ Export Report**. A PDF downloads (`fault-report_…​.pdf`).
3. In the PDF, confirm the reading order and content:
   - **Vehicle State bar** (dark strip) with the operating state at the fault.
   - **Health score + Overall Diagnostic Verdict** ("Critical").
   - The **3D image** (only if the Unity build post‑dates the snapshot bridge; otherwise
     gracefully omitted).
   - Grounded **narrative** + **What the Faults Mean**.
   - **Subsystem Diagnostics** sections — each with **two verdict badges** (RULE + AI), and
     per fault: title, meaning, a **"When:"** operating‑context line, and a **"Check:"** line;
     **Non‑nominal signals** listed for Body & Comfort.
   - **Recommendations** + a compact **full‑roster appendix**.
4. **Regression:** the **Report tab's** "Download PDF" (no 3D report) must still produce the
   legacy flat layout without errors.

---

## 8. Phase 5 — App‑wide enriched text + inline edit

1. Open the session → sniffer **Integrity** tab. Each fault row now shows a **subsystem chip**,
   the plain‑English **title** (raw description on hover), and a **"Check:"** hint — not the raw
   `description`.
2. **Inline edit** (as admin / `diagnostics:write`): click the **✎** button on the Body &
   Comfort SIGNAL_RANGE fault. The modal opens **bound to that fault's rule**:
   - Edit **What it means** / **What to check**, click **Save** → the row text updates
     immediately (faults reload).
   - Because that fault names a signal (`door_latche_status`) but resolved to a generic
     subsystem/default rule, the **"Save as a new rule specific to door_latche_status"**
     checkbox appears — tick it and Save to create a **SIGNAL‑scope** rule (POST). Confirm it
     appears on `/admin/diagnostics` and that re‑opening `/faults` now resolves this fault to
     the more specific rule.
3. **Permission gate:** a user **without** `diagnostics:write` should **not** see the ✎ button.
4. **Round‑trip:** after editing, re‑fetch `/diagnostic-report` and the PDF — the new
   meaning/checks should propagate everywhere (single source of truth = the KB).

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `/faults` returns no `subsystem`/`meaning` | Backend not restarted after the changes, or the KB never seeded (check startup log). |
| `context` is empty on a new session | Session predates the restart, or the message carries no catalogued signals — try the back‑fill path (§5) or re‑ingest after restart. |
| Column error `Unknown column 'context_json'` | Backend runs with `ddl-auto=none` in your env — flip to `update` for one boot (that's how the CAN‑domain tables are managed; none are in a `.sql` migration), or add the column manually: `ALTER TABLE integrity_faults ADD COLUMN context_json TEXT;`. |
| `aiVerdict` always null | `GROQ_API_KEY` unset/invalid or Groq unreachable — deterministic verdicts still work (by design). |
| No faults at all | Confirm ingest finished (frame count > 0) and you used `test_diagnostic_faults.log`; check the backend log for `Saved N fault(s)`. |
| ✎ button missing | You lack `diagnostics:write` (or admin) — expected. |

---

## 10. One‑shot API smoke test

```bash
S=<sessionId>
curl -s -H "Authorization: $TOKEN" "$BASE/can/integrity/sessions/$S/summary"          | jq '{duplicates,timingGaps,signalRangeViolations,counterErrors}'
curl -s -H "Authorization: $TOKEN" "$BASE/can/integrity/sessions/$S/faults"            | jq '[.[] | {faultType,subsystem,title,ruleId,ctx:(.context|length)}]'
curl -s -H "Authorization: $TOKEN" "$BASE/can/integrity/sessions/$S/diagnostic-report" | jq '{overallVerdict, subs:[.subsystems[]|{subsystem,ruleVerdict,aiVerdict}]}'
```
Green run = every field populated, three subsystem groups, `overallVerdict: "Critical"`.
