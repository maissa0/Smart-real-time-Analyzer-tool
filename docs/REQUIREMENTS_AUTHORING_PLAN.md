# Requirements Authoring — Implementation Plan

> Extends the Phase 1–3 requirements feature of `ANOMALY_REDESIGN_PLAN.md`.
> Goal: requirements become fully authorable from the UI — structured editing
> like the catalogues, plus natural-language input (English + French) that is
> analysed and converted into validated structured rules.
>
> Decisions taken with the user on 2026-07-23 (AskUserQuestion rounds):
> full structured Edit tab incl. meta • Groq LLM with local pattern-parser
> fallback • preview + confirm, editable, unresolved signals → draft •
> file picker + new-file creation • EN + FR in both engines • single-sentence
> AND bulk paste • signal scope = catalogs of the cars the file is assigned to
> • car-page entry point (upload OR create-new → builder page) • per-rule
> accept/edit/reject in bulk review • sequencing left to implementer.

---

## Phase A — Structured editing foundation

### A.1 Backend: granular file mutations
The Source round-trip (`GET/PUT /{filename}/source`) stays the ground truth.
Add structured endpoints that mutate the YAML server-side through the existing
`RequirementParser` model (parse → modify → re-serialize → same timestamped
backup + reload path as `saveSource`):
- `POST /api/requirements/{filename}/rules` — add one rule (body = RuleDto).
- `PUT /api/requirements/{filename}/rules/{ruleId}` — replace one rule.
- `DELETE /api/requirements/{filename}/rules/{ruleId}`.
- `PUT /api/requirements/{filename}/meta` — name, signal_map, derived_signals.
- `POST /api/requirements/create` — `{filename, name, carUid?}` → empty valid
  file; when `carUid` present, assign to that car in the same transaction.
- All under `requirement:write`; every mutation re-parses and rejects with the
  parser's line-precise errors before touching disk.

### A.2 Backend: signal context for validation/autocomplete
`GET /api/requirements/{filename}/signal-context` → union of catalog signals
(name + enum labels + owning message) of all cars the file is assigned to;
`?carUid=` variant for the car-page builder (that car only). Unassigned file →
all catalogs + `scoped:false` flag so the UI shows a notice.

### A.3 Frontend: Edit tab on the requirement detail page
Mirror the catalogue detail page's Edit mode:
- Rule list with add / duplicate / delete; per-rule form: id, title, severity,
  kind (drives which fields show), component, draft toggle, preconditions /
  while / trigger / forbidden / expect / expect_all, deadline_ms, duration_ms,
  window_ms, tolerance_pct, state machine (state_signal + allowed transitions),
  violation_title, check_list (chip list).
- Meta section: name, signal_map rows (alias → catalog signal), derived_signals
  editor (name, from-signals, ordered cases of value + conditions).
- Every signal input is an autocomplete fed by A.2; a reference to a signal not
  in scope shows an inline warning ("not in the assigned cars' catalogs —
  rule will be NOT_EVALUABLE") and suggests saving as draft.
- Predicate inputs: builder row (signal / op / value with enum-label dropdown)
  with a raw-text toggle for `in [..]` lists.

## Phase B — Car-page entry point + new-file flow

- Car page: "Requirements" action opens a chooser — **Upload file** (existing
  upload, then auto-assign to this car) or **Create new** → redirect to
  `/requirements/new?car=<uid>`: small form (filename, display name) calling
  A.1 create, then straight into the detail page's Edit tab with the car's
  signal context active.
- Requirements list page keeps upload; gains "New set" using the same flow
  without car pre-selection.

## Phase C — Natural language → structured rule (single sentence)

### C.1 Backend `POST /api/requirements/nl-convert`
Body: `{text, filename?, carUid?, language?: auto}` → response:
`{drafts: [RuleDraftDto], engine: LLM|PARSER, warnings[]}` where each draft =
full RuleDto + per-signal resolution status (`resolved | fuzzy(candidates) |
unresolved`) + confidence + source sentence.
1. **LLM path (Groq, reuse `GroqClient`)** — prompt = rule JSON-schema, the
   scope's signal names/enum labels (from A.2), few-shot examples EN + FR,
   the sentence. Response validated by mapping onto `RequirementParser`'s
   model; invalid LLM output → one retry with the validation error, then fall
   back to the parser. Note in UI: text is sent to the configured LLM.
2. **Local fallback parser** — deterministic patterns, EN + FR, one sentence →
   one rule: "when/quand X {becomes/passe à} V, Y must {become/être} W within
   N ms" (response) • "X must never/ne doit jamais … while/tant que …"
   (absence) • "X must stay/rester … for/pendant N ms" (duration) • "X is
   always/toujours …" / allowed-transition phrasing (invariant). Signal
   matching = normalized exact then fuzzy against scope; unmatched → status
   `unresolved`.
3. Engine choice: LLM when configured/reachable, else parser, surfaced in the
   response (`engine`) so the UI can say which one answered.

### C.2 Frontend
NL input box inside the Edit tab (and the builder page): sentence → convert →
the generated rule opens **pre-filled in the same structured form** (preview +
confirm). Unresolved signals highlighted; saving with any unresolved signal
forces `draft: true`. Nothing is written without the user pressing Save.

## Phase D — Bulk paste (document → many rules)

- `nl-convert` accepts `mode: bulk`: LLM splits the pasted document into
  individual requirements and returns a draft per requirement (bulk is
  LLM-only; parser stays single-sentence — UI disables bulk when offline).
- Review screen: one card per draft — status chip (all signals resolved /
  N unresolved → will be draft), inline edit (opens the same rule form),
  accept / reject per card, then "Save accepted (K)" appends them in one A.1
  batch call (`POST /{filename}/rules/batch`) so the file is written once.

---

## Cross-cutting

- **Security**: all new endpoints `requirement:read/write`; NL text and signal
  names are the only data sent to Groq; server-side re-validation of every
  rule before write (LLM output is untrusted input); no scripting in files
  (unchanged Phase-1 rule).
- **Concurrency**: structured mutations go through the same lock/backup path
  as `saveSource`; ETag/mtime check rejects edits against a stale file copy.
- **Sessions**: unchanged Phase-1 semantics — edits take effect on the next
  session (snapshot at first frame), never mid-session.

## Build order

| # | Work | Size |
|---|------|------|
| A | Granular endpoints + signal-context + structured Edit tab (rules + meta) | L |
| B | Car-page entry point + create-new-file flow | S |
| C | nl-convert (Groq + EN/FR fallback parser) + preview-confirm UI | M–L |
| D | Bulk paste + per-rule review screen | M |

Each phase ends with backend `mvnw test` + `ng build`; C/D add parser unit
tests (EN + FR sentences → expected rules) and an LLM-response-validation test
with canned Groq output.
