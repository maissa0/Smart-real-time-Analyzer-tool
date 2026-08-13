export interface CanSession {
  id: number;
  sessionId: string;
  sourceFilename: string;
  startTs: number;
  /** Nullable server-side (Double) while a session is live; existing call sites already
   * guard with `??`/truthy checks. Kept as non-null `number` here — widening to `| null`
   * cascades into ~30 unrelated compile errors across telemetry/chart code for no practical
   * benefit, since the value is only null transiently before a session completes. */
  endTs: number;
  frameCount: number;
  createdAt: string;
  status?: string | null;
}

export interface DecodedSignal {
  signal_name: string;
  raw_value: number;
  label: string;
}

export interface CanFrame {
  /** Always null — InfluxDB frames have no persisted id. Use msgId+timestamp to correlate. */
  id: number | null;
  sessionId: string;
  timestamp: number;
  channel: number;
  channelName: string;
  msgId: string;
  msgName: string;
  direction: string;
  rawBytes: string;
  signals: string;
}

export function parseSignals(signalsJson: string): DecodedSignal[] {
  try {
    return JSON.parse(signalsJson);
  } catch {
    return [];
  }
}

/** True when a decoded label is a real catalogue enum. The Python decoder
 *  labels enum-less numeric signals with a `raw:<n>` fallback (and undecodable
 *  ones with 'N/A') — neither is worth showing next to the value itself. */
export function hasEnumLabel(label: string | null | undefined): boolean {
  return !!label && label !== 'N/A' && !label.startsWith('raw:');
}

/** One signal reading captured as operating-context for a fault. */
export interface FaultContextSignal {
  name: string;
  value: number | string | null;
  label: string | null;
}

export interface IntegrityFault {
  id: number;
  sessionId: string;
  frameId: number | null;
  msgId: string;
  msgName: string;
  /** SPEC types (DUPLICATE, TIMING_GAP, …) plus REQUIREMENT_VIOLATED,
   *  REQUIREMENT_TIMING_VIOLATED, ILLEGAL_TRANSITION from the requirements engine. */
  faultType: string;
  description: string;
  frameTimestamp: number;
  createdAt: string;
  // ── KB enrichment (present on the enriched /faults response; optional for back-compat) ──
  subsystem?: string;
  title?: string | null;
  meaning?: string | null;
  likelyCause?: string | null;
  whatToCheck?: string | null;
  severity?: number;
  context?: FaultContextSignal[];
  /** Id of the KB rule this fault resolved to — opens it for inline editing. */
  ruleId?: number | null;
  /** Signal named by the fault (SIGNAL_RANGE), for creating a signal-specific rule. */
  signalName?: string | null;
  // ── Findings layers (V8) — present on REQUIREMENT-layer findings ──
  /** Detection layer: SPEC | REQUIREMENT | ML. */
  layer?: string;
  /** Rule id from the requirement file (REQUIREMENT layer only). */
  requirementId?: string | null;
  /** Rule severity CRITICAL|HIGH|MEDIUM|LOW|INFO (REQUIREMENT layer only). */
  ruleSeverity?: string | null;
  /** Repeat count of this exact finding within the session. */
  occurrences?: number;
  /** Frame timestamp (Unix seconds) of the most recent occurrence. */
  lastSeenTs?: number | null;
  /** Parsed evidence object (trigger ts, deadline, latency…). */
  evidence?: unknown;
  /** Diagnostic check-list entries from the violated rule. */
  checkList?: string[];
  // ── Phase 5 fusion (V9) ──
  /** Root-cause cluster this finding belongs to, e.g. "Body & Comfort#1". */
  clusterId?: string | null;
  /**
   * Correlation links: on a REQUIREMENT finding {supportingMl: [...]},
   * on a boosted ML finding {supportsFindingId, requirementId, boostedFrom}.
   */
  correlation?: FindingCorrelation | null;
}

/** One ML finding attached to a REQUIREMENT finding as supporting evidence. */
export interface SupportingMlRef {
  findingId: number;
  faultType: string;
  description: string;
  ts: number;
}

export interface FindingCorrelation {
  supportingMl?: SupportingMlRef[];
  supportsFindingId?: number;
  requirementId?: string;
  boostedFrom?: string;
}

/** Phase-5 probable root cause: 2+ findings, one subsystem, one time window. */
export interface FindingCluster {
  clusterId: string;
  subsystem: string;
  findingCount: number;
  totalOccurrences: number;
  windowStart: number;
  windowEnd: number;
  /** Highest severity in the cluster (CRITICAL..INFO, or SPEC). */
  topSeverity: string;
  /** Ready-to-render summary, e.g. "Body & Comfort: 3 findings in 1.4s". */
  label: string;
  findingIds: number[];
}

/** A user-refinable diagnostic knowledge-base rule (mirrors the backend DiagnosticRuleDto). */
export interface DiagnosticRule {
  id: number | null;
  scope: string;
  matchKey: string;
  faultType: string | null;
  subsystem: string;
  title: string;
  meaning: string;
  likelyCause: string;
  whatToCheck: string;
  severityWeight: number;
  displayName: string | null;
  enabled: boolean;
  builtin: boolean;
  updatedBy: string | null;
}

/** One subsystem group in the diagnostic report — two verdicts side by side. */
export interface SubsystemReport {
  subsystem: string;
  ruleVerdict: string;
  aiVerdict: string | null;
  severityScore: number;
  faultCount: number;
  faults: IntegrityFault[];
  checks: string[];
  implicatedSignals: string[];
}

/** Subsystem-grouped diagnostic report for a session. */
export interface DiagnosticReport {
  sessionId: string;
  totalFaults: number;
  overallVerdict: string;
  subsystems: SubsystemReport[];
}

/** One prior session of the same car, scored with the backend health formula. */
export interface SessionHealthPoint {
  sessionId: string;
  createdAt: string | null;
  healthScore: number;
  faultCount: number;
  frameCount: number | null;
}

/**
 * The unified session report (GET /api/can/sessions/{id}/full-report): one
 * payload composing verdict, requirements, integrity findings, clusters,
 * diagnostics, AI summary and vehicle context. Rendered by the Report tab and
 * printed by both PDF export paths. `summary`/`requirements` use type-only
 * import() references so this model file stays free of runtime imports.
 */
export interface FullReport {
  sessionId: string;
  /** PASS | FAIL — fail when any SPEC fault or violated/timing-violated rule exists. */
  overallVerdict: string;
  specFaultCount: number;
  requirementViolationCount: number;
  summary: import('../services/session-summary.service').SessionSummary | null;
  requirements: import('./requirement.model').RequirementReport | null;
  /** SPEC/ML-layer findings grouped by fault type, worst types first. */
  faultsByType: Record<string, IntegrityFault[]>;
  /** REQUIREMENT-layer findings (rule violations), severity-first. */
  requirementFindings: IntegrityFault[];
  clusters: FindingCluster[];
  diagnostics: DiagnosticReport | null;
  vehicleState: FaultContextSignal[];
  vehicle: string | null;
  /** The car's overall fault rate in % of frames, across all its sessions. */
  carFaultRate: number | null;
  /** Health of the car's previous sessions (newest first) — drives the trend. */
  history: SessionHealthPoint[];
}

export interface IntegritySummary {
  totalFaults: number;
  duplicates: number;
  timingGaps: number;
  signalRangeViolations: number;
  counterErrors: number;
  affectedMsgIds: string[];
  healthy: boolean;
}
