import { Injectable } from '@angular/core';
import type {
  Column,
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';
import { SessionSummary } from './session-summary.service';
import type { DiagnosticReport, FaultContextSignal, FindingCluster, IntegrityFault, SubsystemReport } from '../models/can.model';
import type { RequirementReport } from '../models/requirement.model';

/** One signal row captured from the live/replay roster at export time. */
export interface ReportSignalRow {
  name: string;
  value: string;
  /** Presentational label: 'OK' | 'FAULT' | 'UNDEC' | fault-type short label. */
  status: string;
}

/** One active integrity fault captured at export time. */
export interface ReportFaultRow {
  type: string;
  message: string;
  msgName?: string;
  /** Human-readable relative time (e.g. "+0:12.3"), optional. */
  time?: string;
}

export interface FaultReportInput {
  sessionId: string;
  /** Source filename / display name shown in the header. */
  sessionName?: string;
  vehicle?: string;
  /** AI diagnostic report — omitted when the user hasn't generated one yet. */
  summary?: SessionSummary | null;
  /** 3D viewport PNG as a data URI (data:image/png;base64,...), when captured. */
  snapshotDataUrl?: string | null;
  /** Live/replay signal roster at export time. */
  signals?: ReportSignalRow[];
  /** Active integrity faults at export time. */
  faults?: ReportFaultRow[];
  /** Subsystem-grouped diagnostic report — drives the grouped, plain-English sections. */
  report?: DiagnosticReport | null;
  /** Representative vehicle operating-state for the top-of-report Vehicle State bar. */
  vehicleState?: FaultContextSignal[];
  // ── Unified full-report composition (both export paths pass the same set) ──
  /** Overall verdict: 'PASS' | 'FAIL' (any SPEC fault or violated rule → FAIL). */
  verdict?: string | null;
  /** Counts backing the verdict banner. */
  specFaultCount?: number;
  requirementViolationCount?: number;
  /** Per-rule requirements report — printed as the PASS/VIOLATED table. */
  requirements?: RequirementReport | null;
  /** Probable root causes (top clusters) for the executive page. */
  clusters?: FindingCluster[];
  /** Provenance line, e.g. "Based on 12 findings · 8 rules · generated 10 Aug 2026". */
  provenance?: string | null;
  /** Health trend label vs the car's previous sessions, e.g. "▲ +6 vs previous sessions (avg 72)". */
  trendLabel?: string | null;
}

// ── Branding ────────────────────────────────────────────────────────────────
const BRAND_NAME = 'BONNE BÂTIMENT';
const BRAND_TAGLINE = 'Automotive CAN Diagnostics — Fault Report';
const BRAND_DARK = '#0d1117';
const BRAND_ACCENT = '#b0ff44'; // lime — used on the dark header band only
const HEADING = '#356610'; // darker olive-green, readable on white
const MUTED = '#6b7480';
const HAIRLINE = '#d0d7de';
const FAULT_RED = '#c0392b';
const OK_GREEN = '#2f8f2f';
const UNDEC_AMBER = '#b7791f';

/** Max signal rows embedded before truncating (keeps the PDF a sane size). */
const MAX_SIGNAL_ROWS = 80;
/** Max faults detailed per subsystem before summarising the remainder. */
const MAX_FAULTS_PER_SUBSYSTEM = 12;
/** State signals surfaced (in order) on the per-fault "When:" operating-context line. */
const CONTEXT_LINE_KEYS = ['Gear_Position', 'Speed_High', 'Engine_State', 'KEY_Pos', 'Wheel_Speed_FL'];
/** A4 content width at 40pt page margins. */
const CONTENT_WIDTH = 515;

/**
 * Builds and downloads a branded fault-report PDF entirely client-side.
 * pdfmake is imported lazily so it stays out of the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class FaultReportService {
  /** "Based on N findings · M rules · generated <date>" — same line in UI and PDF. */
  static provenanceLabel(summary: SessionSummary | null | undefined): string | null {
    if (!summary) return null;
    const generated = new Date(summary.generatedAt).toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return `Based on ${summary.errorCount} finding(s) · ${summary.ruleCount ?? 0} rule(s) · generated ${generated}`;
  }

  /** Health trend vs the car's previous sessions — same label in UI and PDF. */
  static trendLabel(
    currentScore: number | null | undefined,
    history: { healthScore: number }[] | null | undefined,
  ): string | null {
    if (currentScore == null || !history?.length) return null;
    const avg = Math.round(history.reduce((sum, h) => sum + h.healthScore, 0) / history.length);
    const delta = currentScore - avg;
    const arrow = delta > 2 ? '▲' : delta < -2 ? '▼' : '→';
    const sign = delta > 0 ? '+' : '';
    return `${arrow} ${sign}${delta} vs this car's previous ${history.length} session(s) (avg ${avg})`;
  }

  async download(input: FaultReportInput): Promise<void> {
    const pdfMake = await this.loadPdfMake();
    const doc = this.buildDocDefinition(input);
    pdfMake.createPdf(doc).download(this.fileName(input));
  }

  // ── pdfmake bootstrap ─────────────────────────────────────────────────────

  private async loadPdfMake(): Promise<{ createPdf: (dd: TDocumentDefinitions) => { download: (f: string) => void } }> {
    const [pdfMakeMod, pdfFontsMod] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]);
    // Module shapes differ across pdfmake builds/bundlers — normalise defensively.
    const pdfMake = (pdfMakeMod as unknown as { default?: unknown }).default ?? pdfMakeMod;
    const fonts = (pdfFontsMod as unknown as { default?: unknown }).default ?? pdfFontsMod;
    // 0.2.x (e.g. 0.2.23) exports the vfs map directly (`module.exports = vfs`);
    // older/other builds nest it under `.pdfMake.vfs` or `.vfs`. Final fallback:
    // the module value itself is the map.
    const vfs = (fonts as { pdfMake?: { vfs?: unknown }; vfs?: unknown }).pdfMake?.vfs
      ?? (fonts as { vfs?: unknown }).vfs
      ?? fonts;
    (pdfMake as { vfs?: unknown }).vfs = vfs;
    return pdfMake as { createPdf: (dd: TDocumentDefinitions) => { download: (f: string) => void } };
  }

  // ── Document assembly ─────────────────────────────────────────────────────

  private buildDocDefinition(input: FaultReportInput): TDocumentDefinitions {
    const grouped = input.report?.subsystems?.length ? input.report : null;

    // ── Page 1: executive view — verdict, health + trend, root causes, actions ──
    const content: Content[] = [
      this.brandHeader(input),
      this.sessionMeta(input),
      this.executiveSummary(input),
    ];
    if (input.verdict) content.push(this.passFailBanner(input));
    if (input.vehicleState?.length) content.push(this.vehicleStateBar(input.vehicleState));
    if (input.summary) content.push(this.healthBlock(input.summary, input.trendLabel));
    if (!input.verdict && grouped) content.push(this.overallVerdictBlock(grouped));
    if (input.snapshotDataUrl) content.push(this.snapshotBlock(input.snapshotDataUrl));
    if (input.clusters?.length) content.push(this.rootCausesBlock(input.clusters));
    if (input.summary?.recommendations?.length) {
      content.push(this.recommendationsBlock(input.summary.recommendations.slice(0, 3)));
    }
    if (input.provenance) {
      content.push({ text: input.provenance, fontSize: 7.5, italics: true, color: MUTED, margin: [0, 6, 0, 0] });
    }

    // ── Appendix: full engineering detail ──
    content.push({
      text: 'ENGINEERING APPENDIX',
      fontSize: 12, bold: true, color: HEADING, characterSpacing: 1,
      pageBreak: 'before', margin: [0, 0, 0, 8],
    });
    if (input.summary?.narrative) {
      content.push(this.sectionHeader('Session Overview — What Happened'));
      content.push({ text: input.summary.narrative, style: 'prose' });
    }
    if (input.summary?.faultAnalysis) {
      content.push(this.sectionHeader('What the Faults Mean'));
      content.push({ text: input.summary.faultAnalysis, style: 'prose' });
    }
    if (input.requirements) content.push(this.requirementsBlock(input.requirements));
    // Grouped subsystem breakdown when the enriched report is available; otherwise the
    // legacy flat faults table (fallback when the full report couldn't be fetched).
    if (grouped) content.push(...this.subsystemSections(grouped));
    else content.push(this.faultsBlock(input));
    if (input.summary?.recommendations?.length && input.summary.recommendations.length > 3) {
      content.push(this.recommendationsBlock(input.summary.recommendations));
    }
    if (input.summary?.networkHealth) {
      content.push(this.sectionHeader('CAN Bus Network Health'));
      content.push({ text: input.summary.networkHealth, style: 'prose' });
    }
    if (input.summary?.keyEvents?.length) content.push(this.keyEventsBlock(input.summary.keyEvents));
    content.push(this.signalsBlock(input));
    if (!input.summary) content.push(this.noReportNotice());

    return {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 55],
      content,
      footer: (currentPage: number, pageCount: number) => ({
        margin: [40, 12, 40, 0],
        columns: [
          { text: `${BRAND_NAME}  ·  Confidential engineering document`, style: 'footer' },
          { text: `Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right' },
        ],
      }),
      styles: {
        prose: { fontSize: 9.5, lineHeight: 1.35, color: '#24292f', margin: [0, 2, 0, 10] },
        sectionTitle: { fontSize: 10, bold: true, color: HEADING, characterSpacing: 0.6, margin: [0, 6, 0, 4] },
        th: { fontSize: 8, bold: true, color: '#ffffff' },
        td: { fontSize: 8.5, color: '#24292f' },
        metaLabel: { fontSize: 8, color: MUTED, characterSpacing: 0.4 },
        metaValue: { fontSize: 9.5, color: '#24292f', bold: true },
        footer: { fontSize: 7.5, color: MUTED },
      },
      defaultStyle: { fontSize: 9.5, color: '#24292f' },
    };
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  private brandHeader(input: FaultReportInput): Content {
    return {
      table: {
        widths: ['*'],
        body: [[{
          border: [false, false, false, false],
          fillColor: BRAND_DARK,
          margin: [16, 14, 16, 14],
          columns: [
            {
              width: '*',
              stack: [
                { text: BRAND_NAME, color: BRAND_ACCENT, bold: true, fontSize: 20, characterSpacing: 1 },
                { text: BRAND_TAGLINE, color: '#9aa4b2', fontSize: 9, margin: [0, 3, 0, 0] },
              ],
            },
            {
              width: 'auto',
              stack: [
                { text: 'FAULT REPORT', color: '#e6edf3', bold: true, fontSize: 12, alignment: 'right' },
                ...(input.vehicle
                  ? [{ text: input.vehicle, color: BRAND_ACCENT, bold: true, fontSize: 10, alignment: 'right' as const, margin: [0, 3, 0, 0] as [number, number, number, number] }]
                  : []),
                { text: this.nowLabel(), color: '#9aa4b2', fontSize: 8, alignment: 'right', margin: [0, 3, 0, 0] },
              ],
            },
          ],
        }]],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 14],
    };
  }

  /**
   * Plain-language opening paragraph: which car, which session, how long,
   * what the verdict is and how the health score reads. Every clause is
   * guarded so partial inputs still produce a coherent sentence.
   */
  private executiveSummary(input: FaultReportInput): Content {
    const s = input.summary;
    const parts: string[] = [];
    const sessionName = input.sessionName ?? input.sessionId;
    parts.push(input.vehicle
      ? `This report covers CAN session "${sessionName}", recorded for the vehicle ${input.vehicle}.`
      : `This report covers CAN session "${sessionName}".`);
    if (s) {
      const dur = this.formatDuration(s.durationSec);
      parts.push(dur === '—'
        ? `The recording is very short and captured ${s.signalCount} distinct signal(s).`
        : `The recording lasted ${dur} and captured ${s.signalCount} distinct signal(s).`);
    }
    if (input.verdict) {
      const spec = input.specFaultCount ?? 0;
      const req = input.requirementViolationCount ?? 0;
      parts.push((input.verdict ?? '').toUpperCase() === 'PASS'
        ? 'The session PASSED every check: no data-integrity faults and no behavioural requirement violations were found.'
        : `The session FAILED its checks: the analyser found ${spec} data-integrity finding(s) `
          + `(problems in how messages arrived on the bus) and ${req} behavioural requirement `
          + `violation(s) (rules the vehicle's behaviour broke). Both are detailed below.`);
    }
    if (s) {
      const trend = input.trendLabel ? ` For context: ${input.trendLabel.replace(/^[▲▼→]\s*/, '')}.` : '';
      parts.push(`Overall the session scores ${s.healthScore}/100 (grade ${s.healthGrade}) — the score starts at 100 and loses points for every fault found.${trend}`);
    }
    return { text: parts.join(' '), style: 'prose', margin: [0, 0, 0, 12] };
  }

  /** Muted one-liner explaining what the section under it means. */
  private explain(text: string): Content {
    return { text, fontSize: 8.5, italics: true, color: MUTED, margin: [0, 2, 0, 6] };
  }

  private sessionMeta(input: FaultReportInput): Content {
    const s = input.summary;
    const cell = (label: string, value: string): Content => ({
      stack: [
        { text: label.toUpperCase(), style: 'metaLabel' },
        { text: value || '—', style: 'metaValue', margin: [0, 1, 0, 0] },
      ],
    });
    return {
      columns: [
        cell('Vehicle', input.vehicle ?? '—'),
        cell('Session', input.sessionName ?? input.sessionId),
        cell('Duration', s ? this.formatDuration(s.durationSec) : '—'),
        cell('Signals', s ? String(s.signalCount) : String(input.signals?.length ?? '—')),
        cell('Total Faults', s ? String(s.errorCount) : String(input.faults?.length ?? '—')),
      ],
      columnGap: 12,
      margin: [0, 0, 0, 12],
    };
  }

  /** Big PASS/FAIL banner backed by the unified verdict (SPEC faults + violated rules). */
  private passFailBanner(input: FaultReportInput): Content {
    const pass = (input.verdict ?? '').toUpperCase() === 'PASS';
    const color = pass ? OK_GREEN : FAULT_RED;
    const detail = [
      `${input.specFaultCount ?? 0} integrity finding(s)`,
      `${input.requirementViolationCount ?? 0} requirement violation(s)`,
    ].join('  ·  ');
    return {
      table: {
        widths: ['*'],
        body: [[{
          border: [false, false, false, false],
          fillColor: pass ? '#eaf7ea' : '#fdeeec',
          margin: [12, 10, 12, 10],
          columns: [
            {
              width: '*',
              stack: [
                { text: 'OVERALL SESSION VERDICT', style: 'metaLabel' },
                { text: pass ? 'PASS' : 'FAIL', fontSize: 18, bold: true, color, margin: [0, 2, 0, 0] },
              ],
            },
            { width: 'auto', text: detail, fontSize: 9, color: '#42484f', margin: [0, 8, 0, 0] },
          ],
        }]],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    };
  }

  /** Top probable root causes (Phase-5 clusters) for the executive page. */
  private rootCausesBlock(clusters: FindingCluster[]): Content {
    const top = clusters.slice(0, 3);
    return {
      stack: [
        this.sectionHeader('Top Probable Root Causes'),
        this.explain('Findings that hit the same subsystem within a short time window usually share one underlying cause. These are the most likely culprits for this session, worst first:'),
        {
          ul: top.map((c) => ({
            text: [
              { text: `[${c.topSeverity}] `, bold: true, color: FAULT_RED },
              { text: c.label },
              { text: c.totalOccurrences > c.findingCount ? `  (${c.totalOccurrences} occurrences)` : '', color: MUTED },
            ],
            margin: [0, 1, 0, 1] as [number, number, number, number],
          })),
          fontSize: 9.5,
          color: '#24292f',
          margin: [0, 0, 0, 6],
        },
      ],
    };
  }

  /** Per-rule requirements verdict table (PASS / VIOLATED / TIMING / NOT_TESTED). */
  private requirementsBlock(req: RequirementReport): Content {
    const stack: Content[] = [
      this.sectionHeader(`Requirements Verdict (${req.totalRules} rules — ${req.passed} passed, ${req.violated} violated, ${req.timingViolated} timing, ${req.notTested} not tested)`),
      this.explain('Every behavioural rule attached to this vehicle was checked against the recorded traffic. '
        + 'PASS means each time the rule applied, the vehicle behaved correctly. VIOLATED means it broke the rule at least once. '
        + 'TIMING means it did the right thing but too late. NOT TESTED means the situation the rule describes never occurred in this session — not a failure, just no evidence either way.'),
    ];
    if (!req.rules.length) {
      stack.push({ text: 'No requirement sets are assigned to this session’s car.', style: 'prose', color: MUTED });
      return { stack, margin: [0, 0, 0, 4] };
    }
    const header: TableCell[] = [
      { text: 'RULE', style: 'th', fillColor: BRAND_DARK },
      { text: 'TITLE', style: 'th', fillColor: BRAND_DARK },
      { text: 'SEVERITY', style: 'th', fillColor: BRAND_DARK },
      { text: 'OUTCOME', style: 'th', fillColor: BRAND_DARK },
      { text: 'PASS', style: 'th', fillColor: BRAND_DARK, alignment: 'right' },
      { text: 'VIOL', style: 'th', fillColor: BRAND_DARK, alignment: 'right' },
      { text: 'TIMING', style: 'th', fillColor: BRAND_DARK, alignment: 'right' },
    ];
    const outcomeOrder: Record<string, number> = { VIOLATED: 0, TIMING_VIOLATED: 1, PASS: 2, NOT_TESTED: 3 };
    const rows: TableCell[][] = [...req.rules]
      .sort((a, b) => (outcomeOrder[a.outcome] ?? 9) - (outcomeOrder[b.outcome] ?? 9))
      .map((r) => [
        { text: r.ruleId, style: 'td', bold: true },
        { text: r.title + (r.draft && !/\(draft\)/i.test(r.title) ? ' (draft)' : ''), style: 'td' },
        { text: r.severity, style: 'td' },
        { text: r.outcome.replace('_', ' '), style: 'td', bold: true, color: this.outcomeColor(r.outcome) },
        { text: String(r.passCount), style: 'td', alignment: 'right' },
        { text: String(r.violatedCount), style: 'td', alignment: 'right' },
        { text: String(r.timingViolatedCount), style: 'td', alignment: 'right' },
      ]);
    stack.push({
      table: { headerRows: 1, widths: [70, '*', 48, 62, 32, 32, 38], body: [header, ...rows] },
      layout: this.tableLayout(),
    });
    return { stack, margin: [0, 0, 0, 8] };
  }

  private outcomeColor(outcome: string): string {
    switch (outcome) {
      case 'PASS': return OK_GREEN;
      case 'VIOLATED': return FAULT_RED;
      case 'TIMING_VIOLATED': return UNDEC_AMBER;
      default: return MUTED;
    }
  }

  private healthBlock(s: SessionSummary, trendLabel?: string | null): Content {
    const color = this.gradeColor(s.healthScore);
    return {
      table: {
        widths: [90, '*'],
        body: [[
          {
            border: [false, false, false, false],
            fillColor: '#f6f8fa',
            margin: [10, 10, 10, 10],
            stack: [
              { text: `${s.healthScore}`, fontSize: 30, bold: true, color, alignment: 'center' },
              { text: '/ 100', fontSize: 8, color: MUTED, alignment: 'center' },
              { text: `Grade ${s.healthGrade}`, fontSize: 9, bold: true, color, alignment: 'center', margin: [0, 4, 0, 0] },
            ],
          },
          {
            border: [false, false, false, false],
            fillColor: '#f6f8fa',
            margin: [12, 10, 12, 10],
            stack: [
              { text: 'HEALTH SCORE', style: 'metaLabel', margin: [0, 0, 0, 4] },
              {
                columns: [
                  this.faultStat('Duplicates', s.faultBreakdown.duplicates, '#c2410c'),
                  this.faultStat('Timing Gaps', s.faultBreakdown.timingGaps, '#a16207'),
                  this.faultStat('Range Violations', s.faultBreakdown.rangeViolations, FAULT_RED),
                ],
                columnGap: 10,
              },
              ...(trendLabel
                ? [{ text: trendLabel, fontSize: 8.5, color: '#42484f', margin: [0, 5, 0, 0] as [number, number, number, number] }]
                : []),
            ],
          },
        ]],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    };
  }

  private faultStat(label: string, count: number, color: string): Column {
    return {
      width: '*',
      stack: [
        { text: String(count), fontSize: 16, bold: true, color },
        { text: label, fontSize: 7.5, color: MUTED },
      ],
    };
  }

  private snapshotBlock(dataUrl: string): Content {
    return {
      stack: [
        this.sectionHeader('3D Digital Twin — Captured Viewport'),
        {
          image: dataUrl,
          width: CONTENT_WIDTH,
          margin: [0, 2, 0, 4],
        },
        { text: 'State of the vehicle model at the moment of capture.', fontSize: 7.5, color: MUTED, italics: true, margin: [0, 0, 0, 10] },
      ],
      // Keep the heading, image and caption on the same page.
      unbreakable: true,
    };
  }

  private faultsBlock(input: FaultReportInput): Content {
    const faults = input.faults ?? [];
    if (faults.length === 0) {
      return {
        stack: [
          this.sectionHeader('Active Faults'),
          { text: 'No integrity faults were active at the time of capture.', style: 'prose', color: OK_GREEN },
        ],
      };
    }

    const header: TableCell[] = [
      { text: 'TYPE', style: 'th', fillColor: BRAND_DARK },
      { text: 'MESSAGE', style: 'th', fillColor: BRAND_DARK },
      { text: 'TIME', style: 'th', fillColor: BRAND_DARK, alignment: 'right' },
    ];
    const rows: TableCell[][] = faults.map((f) => [
      { text: f.type, style: 'td', bold: true, color: FAULT_RED },
      { text: [f.message, f.msgName ? ` (${f.msgName})` : ''].join(''), style: 'td' },
      { text: f.time ?? '—', style: 'td', alignment: 'right' },
    ]);

    return {
      stack: [
        this.sectionHeader('Active Faults'),
        {
          table: { headerRows: 1, widths: [90, '*', 55], body: [header, ...rows] },
          layout: this.tableLayout(),
        },
      ],
      margin: [0, 0, 0, 4],
    };
  }

  private signalsBlock(input: FaultReportInput): Content {
    const signals = input.signals ?? [];
    if (signals.length === 0) return { text: '' };

    const shown = signals.slice(0, MAX_SIGNAL_ROWS);
    const header: TableCell[] = [
      { text: 'SIGNAL', style: 'th', fillColor: BRAND_DARK },
      { text: 'VALUE', style: 'th', fillColor: BRAND_DARK },
      { text: 'STATUS', style: 'th', fillColor: BRAND_DARK, alignment: 'right' },
    ];
    const rows: TableCell[][] = shown.map((r) => [
      { text: r.name, style: 'td' },
      { text: r.value, style: 'td' },
      { text: r.status, style: 'td', bold: true, alignment: 'right', color: this.statusColor(r.status) },
    ]);

    const stack: Content[] = [
      this.sectionHeader(`Signal Roster (${signals.length})`),
      this.explain('Every decoded signal observed in this session with its last value. OK means the value stayed inside its catalog range.'),
      {
        table: { headerRows: 1, widths: ['*', 120, 55], body: [header, ...rows] },
        layout: this.tableLayout(),
      },
    ];
    if (signals.length > MAX_SIGNAL_ROWS) {
      stack.push({ text: `… ${signals.length - MAX_SIGNAL_ROWS} more signals not shown.`, fontSize: 7.5, color: MUTED, italics: true, margin: [0, 4, 0, 0] });
    }
    return { stack, margin: [0, 8, 0, 4] };
  }

  private keyEventsBlock(events: { time: string; description: string }[]): Content {
    return {
      stack: [
        this.sectionHeader('Timeline of Key Events'),
        this.explain('Moments in the recording worth a closer look, with the time offset from the start of the session.'),
        {
          table: {
            widths: [55, '*'],
            body: events.map((e) => [
              { text: e.time, style: 'td', bold: true, color: HEADING },
              { text: e.description, style: 'td' },
            ]),
          },
          layout: this.tableLayout(),
        },
      ],
      margin: [0, 0, 0, 4],
    };
  }

  private recommendationsBlock(recs: string[]): Content {
    return {
      stack: [
        this.sectionHeader('Recommendations'),
        this.explain('Suggested next steps for the workshop or test bench, based on the findings in this report:'),
        {
          ul: recs.map((r) => ({ text: r, margin: [0, 1, 0, 1] })),
          fontSize: 9.5,
          color: '#24292f',
          margin: [0, 0, 0, 6],
        },
      ],
    };
  }

  private noReportNotice(): Content {
    return {
      text: 'No AI diagnostic report has been generated for this session yet. Open the Report tab and generate one for full narrative, network-health and recommendation sections.',
      fontSize: 8.5,
      italics: true,
      color: MUTED,
      margin: [0, 10, 0, 0],
    };
  }

  // ── Grouped diagnostic blocks (Phase 4) ──────────────────────────────────

  /** Dark strip of the vehicle's operating state at the time of the faults. */
  private vehicleStateBar(signals: FaultContextSignal[]): Content {
    const cells: Content[] = signals.slice(0, 8).map((s) => ({
      width: 'auto',
      stack: [
        { text: this.prettySignal(s.name), color: '#9aa4b2', fontSize: 7 },
        { text: this.contextValue(s), color: '#e6edf3', fontSize: 9.5, bold: true, margin: [0, 1, 0, 0] },
      ],
    }));
    return {
      table: {
        widths: ['*'],
        body: [[{
          border: [false, false, false, false],
          fillColor: BRAND_DARK,
          margin: [12, 8, 12, 8],
          stack: [
            { text: 'VEHICLE STATE AT FAULT', color: '#9aa4b2', fontSize: 7.5, characterSpacing: 0.5, margin: [0, 0, 0, 5] },
            { columns: cells, columnGap: 14 },
          ],
        }]],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    };
  }

  private overallVerdictBlock(report: DiagnosticReport): Content {
    const color = this.verdictColor(report.overallVerdict);
    return {
      table: {
        widths: ['*'],
        body: [[{
          border: [false, false, false, false],
          fillColor: '#f6f8fa',
          margin: [12, 10, 12, 10],
          columns: [
            {
              width: '*',
              stack: [
                { text: 'OVERALL DIAGNOSTIC VERDICT', style: 'metaLabel' },
                { text: report.overallVerdict, fontSize: 15, bold: true, color, margin: [0, 2, 0, 0] },
              ],
            },
            {
              width: 'auto',
              stack: [
                { text: String(report.totalFaults), fontSize: 20, bold: true, color, alignment: 'right' },
                { text: 'total faults', style: 'metaLabel', alignment: 'right' },
              ],
            },
          ],
        }]],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    };
  }

  private subsystemSections(report: DiagnosticReport): Content[] {
    const out: Content[] = [
      this.sectionHeader('Subsystem Diagnostics'),
      this.explain('Findings grouped by the part of the vehicle they touch. The RULE badge is the deterministic engine’s verdict; the AI badge is a language model’s independent reading of the same evidence.'),
    ];
    for (const sub of report.subsystems) out.push(this.subsystemBlock(sub));
    return out;
  }

  private subsystemBlock(sub: SubsystemReport): Content {
    const stack: Content[] = [{
      columns: [
        { width: '*', text: sub.subsystem, bold: true, fontSize: 11, color: HEADING, margin: [0, 3, 0, 0] },
        {
          width: 'auto',
          columns: [this.verdictBadge('RULE', sub.ruleVerdict), this.verdictBadge('AI', sub.aiVerdict || '—')],
          columnGap: 6,
        },
      ],
      margin: [0, 6, 0, 2],
    }];

    const detailed = sub.faults.slice(0, MAX_FAULTS_PER_SUBSYSTEM);
    for (const f of detailed) stack.push(this.faultDetail(f));
    if (sub.faults.length > detailed.length) {
      stack.push({
        text: `… ${sub.faults.length - detailed.length} more ${sub.subsystem} faults not detailed.`,
        fontSize: 7.5, italics: true, color: MUTED, margin: [0, 2, 0, 0],
      });
    }
    if (sub.implicatedSignals?.length) {
      stack.push({
        text: [{ text: 'Non-nominal signals: ', bold: true, color: FAULT_RED }, { text: sub.implicatedSignals.join(', ') }],
        fontSize: 8.5, margin: [0, 4, 0, 0],
      });
    }
    return { stack, margin: [0, 0, 0, 10] };
  }

  private verdictBadge(kind: string, verdict: string): Content {
    return {
      table: {
        body: [[{
          border: [false, false, false, false],
          fillColor: this.verdictColor(verdict),
          margin: [6, 2, 6, 2],
          text: [
            { text: `${kind}: `, color: '#ffffff', fontSize: 7, bold: true },
            { text: verdict, color: '#ffffff', fontSize: 8, bold: true },
          ],
        }]],
      },
      layout: 'noBorders',
    };
  }

  private faultDetail(f: IntegrityFault): Content {
    const lines: Content[] = [
      { text: f.title || `${f.faultType} — ${f.msgName ?? ''}`, bold: true, fontSize: 9, color: '#24292f', margin: [0, 4, 0, 0] },
    ];
    if (f.meaning) lines.push({ text: f.meaning, fontSize: 8.5, color: '#42484f', margin: [0, 1, 0, 0] });
    const ctx = this.faultContextLine(f.context);
    if (ctx) {
      lines.push({ text: [{ text: 'When: ', bold: true, color: MUTED }, { text: ctx }], fontSize: 8, color: '#42484f', margin: [0, 1, 0, 0] });
    }
    if (f.whatToCheck) {
      lines.push({ text: [{ text: 'Check: ', bold: true, color: HEADING }, { text: f.whatToCheck }], fontSize: 8, margin: [0, 1, 0, 0] });
    }
    return { stack: lines, margin: [0, 0, 0, 2] };
  }

  private faultContextLine(context?: FaultContextSignal[]): string {
    if (!context?.length) return '';
    const preferred = context.filter((c) => CONTEXT_LINE_KEYS.includes(c.name));
    const use = (preferred.length ? preferred : context).slice(0, 5);
    return use.map((c) => `${this.prettySignal(c.name)}=${this.contextValue(c)}`).join(', ');
  }

  private prettySignal(name: string): string {
    return name.replace(/_/g, ' ');
  }

  private contextValue(s: FaultContextSignal): string {
    if (s.label && s.label.trim()) return s.label;
    return s.value !== null && s.value !== undefined ? String(s.value) : '—';
  }

  private verdictColor(verdict: string): string {
    switch ((verdict || '').toLowerCase()) {
      case 'critical': return FAULT_RED;
      case 'needs attention': return UNDEC_AMBER;
      case 'advisory': return HEADING;
      default: return OK_GREEN; // healthy / unknown
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private sectionHeader(title: string): Content {
    return {
      stack: [
        { text: title.toUpperCase(), style: 'sectionTitle' },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.75, lineColor: HAIRLINE }] },
      ],
      margin: [0, 6, 0, 6],
    };
  }

  private tableLayout() {
    return {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
        i === 0 || i === 1 || i === node.table.body.length ? 0.75 : 0.5,
      vLineWidth: () => 0,
      hLineColor: () => HAIRLINE,
      fillColor: (rowIndex: number) => (rowIndex > 0 && rowIndex % 2 === 0 ? '#f6f8fa' : null),
      paddingTop: () => 4,
      paddingBottom: () => 4,
      paddingLeft: () => 6,
      paddingRight: () => 6,
    };
  }

  private statusColor(status: string): string {
    const s = status.toUpperCase();
    if (s === 'OK') return OK_GREEN;
    if (s === 'UNDEC') return UNDEC_AMBER;
    return FAULT_RED;
  }

  private gradeColor(score: number): string {
    if (score >= 75) return OK_GREEN;
    if (score >= 40) return UNDEC_AMBER;
    return FAULT_RED;
  }

  private formatDuration(sec: number): string {
    if (!sec || sec <= 0) return '—'; // unknown / sub-second — "0s" reads as a bug
    if (sec < 1) return '<1s';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  private nowLabel(): string {
    return new Date().toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  private fileName(input: FaultReportInput): string {
    const base = (input.sessionName || input.sessionId || 'session')
      .replace(/[^a-z0-9._-]+/gi, '_')
      .slice(0, 60);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    return `fault-report_${base}_${stamp}.pdf`;
  }
}
