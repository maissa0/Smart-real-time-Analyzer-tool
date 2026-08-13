/**
 * Requirement-set models (Phase 3, docs/ANOMALY_REDESIGN_PLAN.md).
 * Mirrors the backend RequirementDtos + parsed RequirementModel.RequirementFile.
 * Requirement files are dynamic per-car YAML uploads — nothing here is specific
 * to any rule id or signal name.
 */

/** Listing row for one requirement-set file (GET /api/requirements). */
export interface RequirementSummary {
  filename: string;
  name: string;
  version: string | null;
  ruleCount: number;
  draftCount: number;
  /** false = present on disk but unparseable (shown as invalid in the UI). */
  active: boolean;
}

/** Raw YAML source for the editor round-trip. */
export interface RequirementSource {
  filename: string;
  yaml: string;
}

/** One comparison from the predicate language; `raw` is the original text. */
export interface RequirementPredicate {
  signal: string;
  op: string;
  values: string[];
  raw: string;
}

export interface RequirementEdge {
  signal: string;
  from: string | null;
  to: string | null;
}

export interface RequirementExpectation {
  signal: string;
  becomes: string;
}

export interface RequirementTransition {
  from: string;
  to: string;
}

export interface RequirementDerivedSignal {
  name: string;
  from: string[];
  cases: { value: string; conditions: RequirementPredicate[] }[];
}

/** One parsed rule; field usage depends on `kind` (response|absence|duration|invariant). */
export interface RequirementRule {
  id: string;
  title: string;
  component: string | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  kind: 'RESPONSE' | 'ABSENCE' | 'DURATION' | 'INVARIANT';
  draft: boolean;
  preconditions: RequirementPredicate[];
  whileConds: RequirementPredicate[];
  trigger: RequirementEdge | null;
  forbidden: RequirementEdge | null;
  expect: RequirementExpectation | null;
  expectAll: RequirementPredicate[];
  deadlineMs: number | null;
  durationMs: number | null;
  windowMs: number | null;
  tolerancePct: number | null;
  stateSignal: string | null;
  allowedTransitions: RequirementTransition[];
  violationTitle: string | null;
  checkList: string[];
}

/** Whole parsed requirement-set file (GET /api/requirements/{filename}). */
export interface RequirementFileDetail {
  filename: string;
  name: string;
  version: string | null;
  signalMap: Record<string, string>;
  derivedSignals: RequirementDerivedSignal[];
  rules: RequirementRule[];
}

export type RuleOutcome = 'PASS' | 'VIOLATED' | 'TIMING_VIOLATED' | 'NOT_TESTED';

/** Per-rule outcome row in the session requirements report. */
export interface RuleReport {
  ruleId: string;
  title: string;
  severity: string;
  kind: string;
  draft: boolean;
  sourceFile: string;
  outcome: RuleOutcome;
  passCount: number;
  violatedCount: number;
  timingViolatedCount: number;
}

/** Session requirements report (GET /api/requirements/sessions/{id}/report). */
export interface RequirementReport {
  sessionId: string;
  /** true while the session's engine state is in memory; false = rebuilt from DB. */
  live: boolean;
  totalRules: number;
  exercised: number;
  passed: number;
  violated: number;
  timingViolated: number;
  notTested: number;
  rules: RuleReport[];
}

/** A requirement set assigned to a car (GET /api/cars/{uid}/requirements). */
export interface CarRequirementSet {
  filename: string;
  name: string;
  version: string | null;
}

// ── Structured editing (Phase A, docs/REQUIREMENTS_AUTHORING_PLAN.md) ────────

/** One catalog signal available to a requirement file's rules. */
export interface SignalOption {
  name: string;
  message: string;
  catalog: string;
  labels: string[];
}

/** GET /api/requirements/{filename}/signal-context — signals in scope. */
export interface SignalContext {
  filename: string;
  /** false = file assigned to no car; all catalogs returned as a fallback. */
  scoped: boolean;
  signals: SignalOption[];
}

/**
 * One rule as sent to the granular mutation endpoints. Predicates are the raw
 * predicate strings ("Signal == 'Value'"); the backend re-validates the whole
 * file before writing.
 */
export interface RuleEditPayload {
  id: string;
  title: string | null;
  component: string | null;
  severity: string;
  kind: string;
  draft: boolean;
  preconditions: string[];
  whileConds: string[];
  trigger: RequirementEdge | null;
  forbidden: RequirementEdge | null;
  expect: RequirementExpectation | null;
  expectAll: string[];
  deadlineMs: number | null;
  durationMs: number | null;
  windowMs: number | null;
  tolerancePct: number | null;
  stateSignal: string | null;
  allowedTransitions: string[][];
  violationTitle: string | null;
  checkList: string[];
}

/** How one signal reference in an NL-converted rule resolved against scope. */
export interface SignalResolution {
  reference: string;
  status: 'resolved' | 'fuzzy' | 'unresolved';
  candidates: string[];
}

/** One NL-converted rule draft (nothing saved until the user confirms). */
export interface NlRuleDraft {
  rule: RuleEditPayload;
  signals: SignalResolution[];
  confidence: number;
  source: string;
}

/** POST /api/requirements/nl-convert response. */
export interface NlConvertResponse {
  drafts: NlRuleDraft[];
  engine: 'LLM' | 'PARSER';
  warnings: string[];
}

/** One derived signal in the meta-update payload. */
export interface DerivedSignalPayload {
  name: string;
  from: string[];
  cases: { value: string; when: string[] }[];
}

/** PUT /api/requirements/{filename}/meta payload. */
export interface MetaUpdatePayload {
  name: string | null;
  version: string | null;
  signalMap: Record<string, string>;
  derivedSignals: DerivedSignalPayload[];
}
