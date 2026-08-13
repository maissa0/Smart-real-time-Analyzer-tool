# E2E Scenario Guide — CAN Analyser from A to Z

A complete, verified test kit for the whole chain:
**car creation → catalog assignment → requirement authoring → sessions → findings**.

Everything in this folder was generated against the actual parsers in this repo
(`CatalogService` / `xml_decoder.py` for catalogs, `log_parser.py` for logs,
`RequirementParser` / `RequirementSessionEngine` for requirements) and the three
logs were round-tripped through `python_parser` with `generate_logs.py --verify`.

## Kit contents

| File | Purpose |
|------|---------|
| `e2e_body_can.xml` | Body catalog (0x500–0x503): doors incl. **Opening** state, lock, trunk, hood, windows, wipers + rain sensor, key-fob command (event msg) |
| `e2e_chassis_can.xml` | Chassis catalog (0x600–0x602): 4 wheel speeds, vehicle speed, steering wheel angle, gear (enum), brake event msg |
| `e2e_requirements.yaml` | Requirement set exercising **all rule kinds** + signal_map aliases + derived signal + draft rule |
| `session_clean.log` | Replayable log — everything passes |
| `session_requirement_violations.log` | Deadline miss, forbidden edge, duration violation, illegal transition, invariant break |
| `session_integrity_faults.log` | Timing gap, out-of-range value, duplicate frame, unknown message id |
| `bulk_paste_requirements.txt` | 7 prose requirements for the bulk-paste NL flow |
| `generate_logs.py` | Regenerates + verifies the three logs (`python generate_logs.py --verify`, use `python_parser\.venv\Scripts\python.exe`) |

> **Naming note:** the files are prefixed `e2e_` and use CAN IDs 0x500/0x600
> on purpose — a catalog named `chassis_can.xml` already exists in
> `python_parser/catalogues/` (IDs 0x200–0x203) and uploading a file with the
> same name would overwrite it.

## 0 — Prerequisites

Everything running locally:

1. **MySQL**, **Kafka** (127.0.0.1:9092), **InfluxDB** (localhost:8086).
2. **Backend** — from `backend/`:
   `$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-22.0.2.9-hotspot'; .\mvnw.cmd spring-boot:run`
3. **Frontend** — from `Frontend_angular/`:
   `$env:NODE_OPTIONS='--dns-result-order=ipv4first'; npx ng serve`
4. **Python workers** — from `python_parser/` (use `.venv\Scripts\python.exe`):
   `file_worker.py` (file replay) and `decoder.py` (frame decoding) must run;
   the anomaly worker (`anomaly_engine.py` consumer) is optional but needed for
   step O (ML findings).
5. Log in as an **admin** user (admin bypasses the `requirement:*` /
   `catalog:*` / `car:*` permission checks; a non-admin needs those granted).
6. Optional: `GROQ_API_KEY` set for the backend — required for **bulk paste**
   (step I) and for LLM-quality NL conversion (step H falls back to the
   deterministic parser without it).

---

## Part 1 — Catalogs

### A. Upload the two catalogs
1. Go to **Catalogs** (`/admin/catalogs`).
2. Upload `e2e_body_can.xml`, then `e2e_chassis_can.xml`.
   Upload copies them into `python_parser/catalogues/` and hot-reloads the
   decoder catalog (`CatalogService.uploadCatalog` → `CatalogLoaderService.load`).
3. Expect the list to show **E2E_Body_CAN** (4 messages / 12 signals) and
   **E2E_Chassis_CAN** (3 messages / 8 signals).

### B. Catalog CRUD checks
1. **View**: open `e2e_body_can.xml` → check `Door_Status` shows cycle 500 ms,
   byte/bit layout (`E2E_Door_FL_State` = byte 0 bits 0–2) and the enum table
   (Closed/Opening/Open/Closing/Ajar). `Body_Command` must show as
   **event** (non-cyclic).
2. **Source**: open the Source view — raw XML round-trip.
3. **Edit**: change one label in Source (e.g. `Ajar` → `Ajar_Test`), save
   (a timestamped `.bak-…` backup is written next to the file), verify the
   detail view shows the new label, then change it back.
4. **Delete**: upload a scratch copy (rename a copy to `e2e_scratch.xml`),
   delete it from the list, confirm it disappears (file + DB row removed).
   Do **not** delete the two real e2e catalogs.

---

## Part 2 — Car

### C. Create the car (UI)
1. Go to **Fleet** (`/admin/fleet`) → create car.
2. Suggested values: make `E2E`, model `Tester`, year `2026`, **virtual car**
   checked (VIN optional for virtual cars; if you enter one it must be 17
   chars, no I/O/Q).

### D. Assign both catalogs
1. On the car's card open the **Catalogs** assignment dialog.
2. Assign `e2e_body_can.xml` **and** `e2e_chassis_can.xml`.
3. This matters: sessions replayed *for this car* are decoded and
   integrity-checked against exactly these two files (session catalog scoping),
   and the requirements editor's signal autocomplete comes from them.

---

## Part 3 — Requirements

### E. Upload + assign the requirement set
1. Go to **Requirements** (`/admin/requirements`) → upload
   `e2e_requirements.yaml` (it is parse-validated on upload; a broken file is
   rejected with a line-precise error).
2. Back on **Fleet**, open the car's **Requirements** dialog → assign
   `e2e_requirements.yaml`.
   (Alternative in the same dialog: **⬆ Upload file (auto-assign)** does
   upload + assign in one step.)
3. A car with **no** assigned set has the requirements engine OFF for its
   sessions — there is deliberately no global fallback.

### F. Requirement CRUD via the structured **Edit** tab
1. Open `e2e_requirements.yaml` from the Requirements list → switch the
   detail page to **Edit** (visible with write permission).
2. **Meta**: rename the set (e.g. version `1` → `2`), save, verify in View.
3. **Edit a rule**: open `E2E_R1`, change `deadline_ms` 500 → 400, save, then
   change it back. Each rule card saves individually through the granular
   endpoints (`PUT /api/requirements/{file}/rules/{ruleId}`).
4. **Add a rule**: create a new invariant, e.g. id `E2E_TMP`,
   `expect_all: E2E_Brake_Pedal == 'Released'` with `when:
   E2E_Gear_Position == 'Park'`. Note the signal autocomplete offers only
   signals from the car's assigned catalogs; typing an unknown signal shows an
   out-of-scope warning suggesting **draft**.
5. **Delete** the `E2E_TMP` rule again.
6. **Source** tab: full YAML round-trip with timestamped backup on save.

### G. Create-new flow from the car page
1. Fleet → car → Requirements dialog → **✚ Create new**.
2. You land on `/admin/requirements/new?car=<uid>`; the filename gets `.yaml`
   auto-appended and the set is pre-assigned to the car.
3. After create you are dropped into the detail page in edit mode
   (`?mode=edit`) with an empty rules list — add one rule, then delete the file
   afterwards (list page → delete) to keep the scenario clean.

### H. NL → rule (single sentence)
In the Edit tab's **"Natural language → rule"** card paste, one at a time:

- **English** (response rule):
  `when E2E_Lock_Request becomes Lock_Pressed, E2E_Door_Lock_State must become Locked within 500 ms`
- **French** (absence rule):
  `E2E_Wiper_Mode ne doit jamais passer à Off tant que E2E_Rain_Detected est Raining`

Expected: a converted draft opens as an **UNSAVED** rule card pre-filled in the
structured form, with the engine badge `LLM` (if `GROQ_API_KEY` is set) or
`PARSER` (deterministic fallback — both sentences above are crafted to match
the fallback grammar too). Signals resolve exactly, so the rule is **not**
forced to draft. Discard or save-then-delete them.

### I. Bulk paste (LLM only)
1. Tick the **bulk paste** checkbox on the NL card and paste the whole content
   of `bulk_paste_requirements.txt` (7 prose requirements).
2. Requires `GROQ_API_KEY`; without it the UI shows a warning that bulk is
   unavailable (deterministic fallback is deliberately not used for bulk).
3. Expected: a **Bulk review** section with one card per parsed rule showing
   `resolved` or `N unresolved → draft` chips; toggle **Accept** on a few,
   use **Edit** on one (moves it into the rule list as UNSAVED), then
   **Save accepted (K)** appends them in a single batch write.
4. Delete the bulk-created rules afterwards (or keep them as drafts — they
   never raise findings).

---

## Part 4 — Sessions (replay the three logs)

### J. How to run a log
1. Go to **Fleet** (`/admin/fleet`), select the E2E Tester car, and in the
   **CAN sessions** section click **⬆ Upload log** — the upload panel opens
   with the car pre-selected in the "Link to Vehicle" dropdown. (**▶ Simulator**
   next to it starts a live simulator for the same car; **↻** refreshes the
   session list. The Sniffer page upload still works too.)
2. **Keep the car selected in the dropdown** — the car link is the critical
   part: it scopes decoding/integrity to the two e2e catalogs and arms the 7
   requirement rules (backend log: `"7 requirement rule(s) armed"`).
3. Upload the `.log` file; processing is asynchronous (Kafka). Wait until the
   session shows **COMPLETE** in the workspace sessions list
   (`/admin/workspace`).
4. Repeat per log — run them in this order: **clean → violations → integrity**
   (the clean-first order also gives the ML layer a clean baseline session).

### K. Where to look
Open the session from **Workspace** (`/admin/workspace/session/<sessionId>`).
Tabs: **Table | Charts | Integrity | Requirements | Report | 3D Twin**.

- **Table** — decoded frames; unknown ids appear with message name `UNKNOWN`.
- **Integrity** — SPEC-layer faults (TIMING_GAP, SIGNAL_RANGE, DUPLICATE,
  MESSAGE_TIMEOUT…) with occurrence counts and vehicle context.
- **Requirements** — per-rule outcome chips
  (**PASS / VIOLATED / TIMING_VIOLATED / NOT_TESTED**), coverage counters,
  finding cards with evidence, check-list ("what to check"), **Probable root
  causes** cluster chips and **Supporting ML evidence** when correlated.
  API equivalent: `GET /api/requirements/sessions/{id}/report`,
  faults: `GET /api/can/integrity/sessions/{id}/faults`,
  clusters: `GET /api/can/integrity/sessions/{id}/clusters`.

### L. Expected results — `session_clean.log` (~20 s, 293 frames)

Requirements tab:

| Rule | Outcome | Why |
|------|---------|-----|
| E2E_R1 (response) | **PASS** (1) | lock press at t≈3.01 answered at t≈3.32 → 310 ms ≤ 500 ms |
| E2E_A1 (absence) | **NOT_TESTED** | never unlocked while moving — absence rules can only be VIOLATED or NOT_TESTED; NOT_TESTED here means "forbidden event never occurred" |
| E2E_A2 (absence) | **NOT_TESTED** | it never rains |
| E2E_D1 (duration) | **PASS** (1) | unlocked 2.02 → relocked 3.32 (1.3 s < 5 s) |
| E2E_I1 (invariant/transitions) | **PASS** (4) | door cycles Closed→Opening→Open→Closing→Closed |
| E2E_I2 (invariant/predicate) | **PASS** (1) | trunk + hood closed during the whole 60 km/h drive |
| E2E_DR1 (draft) | **NOT_TESTED** | drafts never report a verdict |

Integrity tab: **no faults during replay**, except — after the file ends —
one benign **MESSAGE_TIMEOUT per cyclic message** (5: Door_Status,
Window_Status, Wiper_Rain_Status, Wheel_Speeds, Vehicle_Dynamics) whose text
says "ECU stopped transmitting **or stream ended**". That is the expected
end-of-replay artifact for every replayed file, in all three sessions.

> **Timing note on PASS counts:** the report is served live from the in-memory
> engine, which for file replays stays resident after COMPLETE. If you restart
> the backend and re-open the report, it is rebuilt from persisted findings
> only — violations survive, but PASS becomes NOT_TESTED (pass counters are
> not persisted). So check reports before restarting the backend.

### M. Expected results — `session_requirement_violations.log` (~30 s, 446 frames)

Integrity tab: clean (same end-of-replay MESSAGE_TIMEOUTs only).
Requirements tab findings, in log order:

| t (s) | Rule | Finding type | Severity | Evidence highlights |
|-------|------|-------------|----------|---------------------|
| ~7.05 | E2E_D1 | REQUIREMENT_VIOLATED | MEDIUM | unlocked at 2.02, still unlocked past the 5 s window |
| 10.31 | E2E_R1 | REQUIREMENT_TIMING_VIOLATED | HIGH | latency ≈ 1300 ms vs 500 ms deadline |
| ~13.65 | E2E_R1 | REQUIREMENT_VIOLATED | HIGH | press at 13.01, no lock before the 13.51 deadline |
| 18.03 | E2E_A1 | REQUIREMENT_VIOLATED | CRITICAL | DoorLock Locked→Unlocked while at 60 km/h |
| 20.03 | E2E_I2 | REQUIREMENT_VIOLATED | HIGH | trunk not Closed while moving |
| 20.53 | E2E_I1 | ILLEGAL_TRANSITION | HIGH | door jumped Closed→Open (Opening skipped) |
| 24.43 | E2E_A2 | REQUIREMENT_VIOLATED | MEDIUM | wipers → Off while Rain = Raining |

Also check:

- **Outcome chips**: R1 shows VIOLATED (violated=1, timing=1 — VIOLATED
  dominates), D1 shows VIOLATED with counters pass=2 / violated=1 (it re-armed
  and passed twice later), I1 shows VIOLATED with pass=2 / violated=1.
- **Draft behaviour**: at 26.01 a `Trunk_Release` press deliberately goes
  unanswered — E2E_DR1 counts a violation internally but raises **no finding**
  and stays NOT_TESTED.
- **Root-cause cluster**: E2E_I2 (20.03) and E2E_I1 (20.53) are both
  body-subsystem findings within the 2 s window → one cluster chip
  ("Probable root causes", subsystem of E2E_Body_CAN) linking both cards.
  Verify via `GET /api/can/integrity/sessions/{id}/clusters`.

### N. Expected results — `session_integrity_faults.log` (~12 s, 170 frames)

Requirements tab: **all 7 rules NOT_TESTED** (nothing moves, nothing is
pressed) — proving requirement findings and integrity faults are independent
layers. Integrity tab:

| t (s) | Fault | Message | Detail |
|-------|-------|---------|--------|
| 5.20 | **TIMING_GAP** | Wheel_Speeds | gap 1.20 s > 0.3 s limit (cycle 100 ms × 3) |
| 6.05 | **SIGNAL_RANGE** | Vehicle_Dynamics | `E2E_Gear_Position` value 7 not in valid set {0,1,2,3,4} — occurrences 3 (held for 3 ticks) |
| 8.1505 | **DUPLICATE** | Door_Status | identical frame 0.5 ms after the 8.15 tick |
| end | **MESSAGE_TIMEOUT** ×5 | all cyclic msgs | benign end-of-replay artifact |

**Unknown message id (0x6FF, 4 frames at 1.5/4.5/7.5/10.5):** verified
behaviour is that unknown ids are decoded as message name **UNKNOWN** — they
appear in the **Table** tab (and the decoder worker logs "Unknown ECU — frame
ID 0x6FF not found in catalog"), but the integrity analyzer raises **no
dedicated fault** for them. Judge this in the frame table, not the faults list.

(Sequence/counter faults can't be produced from a log file: `frame_seq` is
assigned sequentially by the file worker itself, so COUNTER_ERROR /
SEQUENCE_REGRESSION only occur on live streams.)

### O. ML ↔ requirement correlation
1. Requires the anomaly worker running. Its layer produces advisory findings:
   `SIGNAL_TRANSITION` (LOW, never-seen enum transition), `INTER_ARRIVAL`
   (INFO, cadence jitter), `OUTLIER` (INFO).
2. Because you ran the **clean** session first, it forms a clean baseline
   (only sessions with zero SPEC/REQUIREMENT findings are learned from).
   During the violations replay, transitions the model never saw (e.g.
   `Locked→Unlocked` at speed) can fire ML events at the same instant as the
   requirement finding.
3. When an ML finding lands inside a requirement finding's evidence window,
   the correlator merges them: the requirement card shows **"Supporting ML
   evidence"**, and the ML finding is boosted LOW→MEDIUM with a
   `correlation` link. This is opportunistic — ML output depends on learned
   state, so treat the *presence* of the merge UI as the test, not exact
   counts.

### P. Session compare / report extras (optional)
- **Report** tab: the auto-generated session report (frame stats + findings).
- `/admin/compare`: compare the clean vs violations sessions.
- The **3D Twin** tab: requirement `component` keys (e.g. `driver_door`,
  `trunk`) drive mesh highlighting for open findings.

---

## Part 5 — Cleanup (Z)

1. **Sessions**: Workspace sessions list → delete the three e2e sessions
   (removes Influx frames, MySQL rows, findings, and in-memory engine state).
2. **Requirement rules created during testing**: delete any `E2E_TMP` /
   NL / bulk rules you saved, or delete the whole set: Requirements page →
   delete `e2e_requirements.yaml` (unassign from the car first in Fleet).
   Also delete any set created in step G.
3. **Catalogs**: Catalogs page → delete `e2e_body_can.xml` and
   `e2e_chassis_can.xml` (leaves the pre-existing catalogs untouched). Note the
   editor's `.bak-…` files from step B stay in `python_parser/catalogues/` —
   remove them manually if you want a spotless directory.
4. **Car**: Fleet page → delete the `E2E Tester` car.
5. **Uploaded log copies**: replays leave `<sessionId>_session_*.log` copies in
   `C:/tools/Kpit_c/uploads/` — delete manually if desired (session delete
   does not remove them).
6. Regenerate the logs anytime:
   `python_parser\.venv\Scripts\python.exe test-data\e2e-scenario\generate_logs.py --verify`
