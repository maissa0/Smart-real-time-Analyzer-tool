import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, of, switchMap, filter, take, catchError } from 'rxjs';
import {
  SessionSummary,
  SessionSummaryService,
  FaultPoint,
} from '../../../../core/services/session-summary.service';
import { FaultReportService } from '../../../../core/services/fault-report.service';
import { CanService } from '../../../../core/services/can.service';
import { FindingFocusService } from '../../../../core/services/finding-focus.service';
import {
  CanSession,
  FullReport,
  IntegrityFault,
} from '../../../../core/models/can.model';
import { RuleReport } from '../../../../core/models/requirement.model';
import { NlAskComponent } from '../../../../shared/components/nl-ask/nl-ask.component';

type ReportState = 'loading' | 'loaded' | 'error';

interface TimelineDot { x: number; color: string; type: string; }

/** Same plain-language fault-type meta as the Checks tab, for one visual language. */
const FAULT_TYPE_META: Record<string, { label: string; color: string }> = {
  SIGNAL_RANGE:        { label: 'Range Violation', color: '#f87171' },
  COUNTER_ERROR:       { label: 'Counter Error',   color: '#c084fc' },
  SEQUENCE_REGRESSION: { label: 'Counter Reset',   color: '#e879f9' },
  TIMING_GAP:          { label: 'Timing Gap',      color: '#fbbf24' },
  DUPLICATE:           { label: 'Duplicate',       color: '#fb923c' },
  MESSAGE_TIMEOUT:     { label: 'Message Timeout', color: '#22d3ee' },
};

const HEALTH_SCORE_TOOLTIP =
  'How the health score is computed: it starts at 100 and deducts points for the '
  + 'session’s fault rate (faults ÷ frames: −40 at ≥10%, −20 at ≥1%, −5 for any) '
  + 'plus up to −20 for the absolute fault count (1 point per 5 faults). '
  + 'Requirement outcomes are reported separately and do not affect the score.';

/**
 * The unified session report: one authoritative composition (verdict,
 * requirements verdict, integrity findings, root-cause clusters, AI summary,
 * vehicle context) rendered as a navigation hub — every finding deep-links to
 * its evidence in the Charts, Table and 3D Twin views. The top of the page is
 * the manager view; the collapsible Engineering detail carries everything else.
 */
@Component({
  selector: 'app-report-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, NlAskComponent],
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow-y: auto; background: #07090b; }
    .report-wrap { max-width: 1060px; margin: 0 auto; padding: 1.25rem 1.25rem 3rem; width: 100%; }

    /* ── State screens ── */
    .state-center {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 300px; gap: 1rem; color: #484f58; font-size: 0.82rem;
    }
    .state-center h3 { color: #8a9ab0; font-size: 1rem; margin: 0; }
    .spinner {
      width: 24px; height: 24px; border: 2px solid #21262d; border-top-color: #b0ff44;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Buttons ── */
    .btn {
      padding: 6px 14px; border-radius: 7px; font-size: 0.75rem; font-weight: 600;
      cursor: pointer; border: 1px solid; transition: all 0.15s; display: inline-flex; align-items: center; gap: 0.35rem;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary   { background: rgba(176,255,68,.12); border-color: rgba(176,255,68,.3); color: #b0ff44; }
    .btn-primary:hover:not(:disabled) { background: rgba(176,255,68,.2); }
    .btn-secondary { background: transparent; border-color: #30363d; color: #8a9ab0; }
    .btn-secondary:hover:not(:disabled) { border-color: #b0ff44; color: #b0ff44; }

    /* ── Verdict banner (same language as the Checks tab) ── */
    .verdict {
      display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
      border-radius: 12px; padding: 0.8rem 1.1rem; margin-bottom: 0.9rem;
      border: 1px solid rgba(255,255,255,0.08); background: #0d1117;
    }
    .verdict-badge {
      font-size: 1rem; font-weight: 800; letter-spacing: 0.04em;
      padding: 0.35rem 0.9rem; border-radius: 8px; white-space: nowrap;
    }
    .verdict-pass .verdict-badge { background: rgba(63,185,80,0.15); color: #3fb950; }
    .verdict-fail .verdict-badge { background: rgba(255,68,68,0.15); color: #ff4444; }
    .verdict-pass { border-color: rgba(63,185,80,0.25); }
    .verdict-fail { border-color: rgba(255,68,68,0.25); }
    .verdict-sub { font-size: 0.74rem; color: #8a9ab0; }
    .verdict-actions { margin-left: auto; display: flex; gap: 0.6rem; align-items: center; }

    /* ── Staleness banner ── */
    .stale-banner {
      display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
      border: 1px solid rgba(227,179,65,0.4); background: rgba(227,179,65,0.08);
      color: #e3b341; border-radius: 10px; padding: 0.6rem 1rem; margin-bottom: 0.9rem;
      font-size: 0.76rem;
    }
    .stale-banner .btn { margin-left: auto; }

    /* ── Header: health ring + overview ── */
    .report-header {
      display: flex; align-items: flex-start; gap: 2rem; margin-bottom: 1rem;
      background: #0d1117; border: 1px solid #21262d; border-radius: 12px; padding: 1.25rem 1.5rem;
    }
    .health-ring-wrap { display: flex; flex-direction: column; align-items: center; gap: 0.45rem; flex-shrink: 0; }
    .health-ring-wrap svg { display: block; }
    .grade-badge {
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
      padding: 3px 10px; border-radius: 20px; border: 1px solid currentColor;
    }
    .trend-line { font-size: 0.68rem; color: #8a9ab0; text-align: center; max-width: 170px; }
    .trend-up { color: #3fb950; } .trend-down { color: #ff4444; }
    .info-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 15px; height: 15px; border-radius: 50%; border: 1px solid #484f58;
      color: #8a9ab0; font-size: 0.6rem; cursor: help; vertical-align: middle; margin-left: 4px;
    }
    .overview { flex: 1; min-width: 0; }
    .overview h2 { font-size: 1rem; font-weight: 700; color: #e6edf3; margin: 0 0 0.6rem; }
    .overview-grid {
      display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 0.35rem 1.25rem;
      font-size: 0.78rem;
    }
    .overview-grid .lbl { color: #484f58; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; }
    .overview-grid .val { color: #c9d1d9; }
    .provenance { font-size: 0.66rem; color: #484f58; margin-top: 0.75rem; }
    .no-summary { display: flex; flex-direction: column; gap: 0.6rem; align-items: flex-start; }
    .no-summary span { font-size: 0.76rem; color: #8a9ab0; }

    /* ── Sections ── */
    .section { margin-bottom: 1.25rem; }
    .section-title {
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
      color: #484f58; margin: 0 0 0.6rem; padding-bottom: 0.4rem; border-bottom: 1px solid #21262d;
    }
    .prose {
      font-size: 0.82rem; line-height: 1.8; color: #c9d1d9;
      background: #0d1117; border: 1px solid #21262d; border-radius: 8px;
      padding: 1.1rem 1.35rem; white-space: pre-wrap; word-break: break-word;
    }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; }
    @media (max-width: 680px) { .two-col { grid-template-columns: 1fr; } }

    /* ── Root-cause chips (as in the Checks tab) ── */
    .cluster-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .cluster-chip {
      display: inline-flex; align-items: center; gap: 0.45rem;
      background: #0d1117; border: 1px solid rgba(255,140,66,0.35); border-radius: 10px;
      padding: 0.45rem 0.8rem; font-size: 0.74rem; color: #e6edf3;
    }
    .cluster-occ { color: #8a9ab0; font-size: 0.66rem; }
    .badge {
      padding: 2px 8px; border-radius: 4px; font-size: 0.6rem; font-weight: 700;
      letter-spacing: 0.05em; white-space: nowrap;
    }
    .sev-CRITICAL { background: rgba(255,68,68,0.18); color: #ff4444; }
    .sev-HIGH { background: rgba(255,140,66,0.15); color: #ff8c42; }
    .sev-MEDIUM { background: rgba(227,179,65,0.14); color: #e3b341; }
    .sev-LOW { background: rgba(88,166,255,0.12); color: #58a6ff; }
    .sev-INFO, .sev-SPEC { background: rgba(138,154,176,0.15); color: #8a9ab0; }

    /* ── Recommendations ── */
    .recs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    .rec-item {
      display: flex; gap: 0.75rem; align-items: flex-start;
      font-size: 0.8rem; color: #c9d1d9; line-height: 1.6;
    }
    .rec-bullet { color: #b0ff44; font-size: 1rem; flex-shrink: 0; margin-top: 1px; }

    /* ── Engineering-detail toggle ── */
    .detail-toggle {
      width: 100%; display: flex; align-items: center; gap: 0.6rem;
      background: #0d1117; border: 1px solid #21262d; border-radius: 10px;
      color: #8a9ab0; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; padding: 0.7rem 1rem; cursor: pointer;
      margin-bottom: 1rem; transition: all 0.15s;
    }
    .detail-toggle:hover { border-color: rgba(176,255,68,0.3); color: #b0ff44; }
    .detail-toggle .chev { font-size: 0.7rem; }
    .detail-toggle .hint { margin-left: auto; font-size: 0.64rem; font-weight: 400; text-transform: none; color: #484f58; }

    /* ── Requirements table ── */
    .req-table {
      width: 100%; border-collapse: collapse; font-size: 0.74rem;
      background: #0d1117; border: 1px solid #21262d; border-radius: 8px; overflow: hidden;
    }
    .req-table th {
      background: #161b22; color: #484f58; font-weight: 600; font-size: 0.62rem;
      letter-spacing: 0.07em; text-transform: uppercase; padding: 0.55rem 0.8rem; text-align: left;
    }
    .req-table td { padding: 0.45rem 0.8rem; color: #c9d1d9; border-top: 1px solid #161b22; }
    .req-table tr:hover td { background: #161b22; }
    .rule-chip {
      font-family: monospace; font-size: 0.68rem; font-weight: 700; color: #b0ff44;
      background: rgba(176,255,68,0.1); padding: 2px 8px; border-radius: 4px; white-space: nowrap;
    }
    .outcome {
      padding: 2px 8px; border-radius: 4px; font-size: 0.62rem; font-weight: 700;
      letter-spacing: 0.04em; white-space: nowrap;
    }
    .out-PASS { background: rgba(63,185,80,0.15); color: #3fb950; }
    .out-VIOLATED { background: rgba(255,68,68,0.15); color: #ff4444; }
    .out-TIMING_VIOLATED { background: rgba(255,140,66,0.15); color: #ff8c42; }
    .out-NOT_TESTED { background: rgba(72,79,88,0.2); color: #8a9ab0; }

    /* ── Evidence rows (faults / violations / key events) ── */
    .group-head {
      display: flex; align-items: center; gap: 0.6rem; margin: 0.8rem 0 0.4rem;
      font-size: 0.74rem; font-weight: 700; color: #e6edf3;
    }
    .group-count {
      font-size: 0.62rem; color: #8a9ab0; background: rgba(72,79,88,0.25);
      padding: 2px 8px; border-radius: 10px; font-weight: 600;
    }
    .evidence-row {
      display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
      background: #0d1117; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
      padding: 0.5rem 0.8rem; margin-bottom: 0.35rem; border-left: 3px solid #484f58;
      font-size: 0.76rem; color: #c9d1d9;
    }
    .evidence-desc { flex: 1; min-width: 220px; line-height: 1.45; }
    .msg-chip { font-family: monospace; font-size: 0.66rem; color: #b0ff44; }
    .evidence-ts { font-size: 0.65rem; color: #484f58; font-family: monospace; white-space: nowrap; }
    .occ {
      font-size: 0.65rem; color: #8a9ab0; background: rgba(72,79,88,0.25);
      padding: 2px 8px; border-radius: 10px; font-weight: 600;
    }
    .link-btns { display: flex; gap: 0.35rem; }
    .btn-link {
      background: none; border: 1px solid rgba(176,255,68,0.25); border-radius: 5px;
      color: #b0ff44; font-size: 0.65rem; font-weight: 600; padding: 2px 8px;
      cursor: pointer; transition: all 0.15s; white-space: nowrap;
    }
    .btn-link:hover { background: rgba(176,255,68,0.08); }
    .more-note { font-size: 0.68rem; color: #484f58; font-style: italic; margin: 0.2rem 0 0.6rem; }

    /* ── Timeline ── */
    .timeline-wrap { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 1rem 1.35rem; }
    .timeline-svg  { width: 100%; }
    .timeline-labels {
      display: flex; justify-content: space-between; font-size: 0.62rem; color: #484f58;
      margin-top: 0.35rem; padding: 0 20px;
    }
    .legend { display: flex; gap: 1rem; margin-top: 0.75rem; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 0.35rem; font-size: 0.65rem; color: #8a9ab0; }
    .legend-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

    /* ── Signal table ── */
    .signal-table {
      width: 100%; border-collapse: collapse; font-size: 0.75rem;
      background: #0d1117; border: 1px solid #21262d; border-radius: 8px; overflow: hidden;
    }
    .signal-table th {
      background: #161b22; color: #484f58; font-weight: 600; font-size: 0.62rem;
      letter-spacing: 0.07em; text-transform: uppercase; padding: 0.6rem 0.85rem; text-align: left;
    }
    .signal-table td { padding: 0.5rem 0.85rem; color: #c9d1d9; border-top: 1px solid #161b22; }
    .signal-table tr:hover td { background: #161b22; }
    .sig-name { font-family: monospace; font-size: 0.72rem; color: #b0ff44; max-width: 220px; word-break: break-all; }

    /* ── Key events ── */
    .event-time {
      font-family: monospace; font-size: 0.72rem; color: #b0ff44; white-space: nowrap;
      background: rgba(176,255,68,.08); border: 1px solid rgba(176,255,68,.2);
      border-radius: 4px; padding: 2px 6px;
    }

    .ask-block { margin-top: 1.25rem; }

    /* ── Footer ── */
    .report-footer {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 0.65rem; color: #484f58; margin-top: 1.5rem; padding-top: 1rem;
      border-top: 1px solid #21262d;
    }
    .model-chip {
      font-size: 0.65rem; color: #484f58; background: #161b22; border: 1px solid #21262d;
      border-radius: 4px; padding: 3px 7px;
    }
    .empty-note { font-size: 0.74rem; color: #484f58; padding: 0.6rem 0; }
  `],
  template: `
    <div class="report-wrap">
      @switch (state()) {

        @case ('loading') {
          <div class="state-center">
            <div class="spinner"></div>
            <span>Loading session report…</span>
          </div>
        }

        @case ('error') {
          <div class="state-center">
            <h3>Report unavailable</h3>
            <span>The session report could not be loaded.</span>
            <button class="btn btn-primary" (click)="loadReport()">Retry</button>
          </div>
        }

        @case ('loaded') {
          @if (fullReport(); as fr) {

            <!-- ── Verdict banner ── -->
            <div class="verdict" [class.verdict-pass]="fr.overallVerdict === 'PASS'"
                 [class.verdict-fail]="fr.overallVerdict !== 'PASS'">
              <span class="verdict-badge">
                {{ fr.overallVerdict === 'PASS' ? 'SESSION PASSED' : 'SESSION FAILED' }}
              </span>
              <span class="verdict-sub">
                {{ fr.specFaultCount }} integrity finding{{ fr.specFaultCount === 1 ? '' : 's' }}
                · {{ fr.requirementViolationCount }} requirement violation{{ fr.requirementViolationCount === 1 ? '' : 's' }}
                @if (fr.vehicle) { · {{ fr.vehicle }} }
              </span>
              <div class="verdict-actions">
                <button class="btn btn-primary" [disabled]="generating()" (click)="generate()">
                  {{ generating() ? 'Generating…' : fr.summary ? 'Regenerate' : 'Generate AI Summary' }}
                </button>
                <button class="btn btn-secondary" [disabled]="!fr.summary" (click)="downloadPdf()"
                        [title]="fr.summary ? '' : 'Generate the AI summary first for the complete PDF'">
                  Download PDF
                </button>
              </div>
            </div>

            <!-- ── Staleness ── -->
            @if (isStale()) {
              <div class="stale-banner">
                <span>Data changed since this report was generated —
                  it was based on {{ fr.summary?.errorCount }} finding(s) / {{ fr.summary?.ruleCount ?? 0 }} rule(s),
                  the session now has {{ currentFindingCount() }} finding(s) / {{ currentRuleCount() }} rule(s).</span>
                <button class="btn btn-primary" [disabled]="generating()" (click)="generate()">
                  {{ generating() ? 'Generating…' : 'Regenerate' }}
                </button>
              </div>
            }

            <!-- ── Health + overview ── -->
            <div class="report-header">
              @if (fr.summary; as s) {
                <div class="health-ring-wrap">
                  <svg viewBox="0 0 100 100" width="110" height="110">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#21262d" stroke-width="8"/>
                    <circle cx="50" cy="50" r="42" fill="none"
                      [attr.stroke]="ringColor(s.healthScore)"
                      stroke-width="8"
                      stroke-linecap="round"
                      [attr.stroke-dasharray]="264"
                      [attr.stroke-dashoffset]="264 * (1 - s.healthScore / 100)"
                      transform="rotate(-90 50 50)"/>
                    <text x="50" y="46" text-anchor="middle" fill="#e6edf3" font-size="20" font-weight="800">
                      {{ s.healthScore }}
                    </text>
                    <text x="50" y="62" text-anchor="middle" fill="#484f58" font-size="9">/ 100</text>
                  </svg>
                  <span class="grade-badge" [style.color]="ringColor(s.healthScore)"
                        [style.border-color]="ringColor(s.healthScore)"
                        [title]="healthTooltip">
                    Grade {{ s.healthGrade }}
                  </span>
                  @if (trendLabel(); as trend) {
                    <span class="trend-line"
                          [class.trend-up]="trend.startsWith('▲')"
                          [class.trend-down]="trend.startsWith('▼')">{{ trend }}</span>
                  }
                </div>
              }

              <div class="overview">
                <h2>Session Diagnostic Report</h2>
                @if (fr.summary; as s) {
                  <div class="overview-grid">
                    <span class="lbl">Duration</span>
                    <span class="val">{{ formatDuration(s.durationSec) }}</span>
                    <span class="lbl">Signals</span>
                    <span class="val">{{ s.signalCount }}</span>
                    <span class="lbl">Integrity findings</span>
                    <span class="val" [style.color]="fr.specFaultCount > 0 ? '#ff4444' : '#3fb950'">
                      {{ fr.specFaultCount }}
                    </span>
                    <span class="lbl">Requirement rules</span>
                    <span class="val">
                      @if (fr.requirements; as req) {
                        {{ req.passed }}/{{ req.totalRules }} passed
                        @if (req.violated + req.timingViolated > 0) {
                          <span style="color:#ff4444"> · {{ req.violated + req.timingViolated }} violated</span>
                        }
                      } @else { — }
                    </span>
                    @if (fr.carFaultRate !== null) {
                      <span class="lbl">Car fault rate</span>
                      <span class="val">{{ fr.carFaultRate | number:'1.2-2' }}% of frames (all sessions)</span>
                    }
                  </div>
                  @if (provenance(); as p) { <div class="provenance">{{ p }}</div> }
                } @else {
                  <div class="no-summary">
                    <span>No AI summary has been generated for this session yet. The verdict,
                    requirements table and findings below are live; generate the summary to add the
                    plain-English narrative, health score and recommendations.</span>
                    @if (generating()) {
                      <span>Analysing signals and faults — this may take 15–30 seconds…</span>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- ── Top-3 root causes ── -->
            @if (fr.clusters.length > 0) {
              <div class="section">
                <div class="section-title">Top Probable Root Causes</div>
                <div class="cluster-row">
                  @for (c of fr.clusters.slice(0, 3); track c.clusterId) {
                    <span class="cluster-chip">
                      <span class="badge" [class]="'badge sev-' + c.topSeverity">{{ c.topSeverity }}</span>
                      {{ c.label }}
                      @if (c.totalOccurrences > c.findingCount) {
                        <span class="cluster-occ">({{ c.totalOccurrences }} occurrences)</span>
                      }
                      <button class="btn-link" (click)="viewClusterInCharts(c)"
                              title="Zoom the signal charts to this cluster's window">Charts →</button>
                    </span>
                  }
                </div>
              </div>
            }

            <!-- ── Top-3 recommendations ── -->
            @if (fr.summary?.recommendations?.length) {
              <div class="section">
                <div class="section-title">Top Recommendations</div>
                <ul class="recs-list">
                  @for (rec of fr.summary!.recommendations.slice(0, 3); track $index) {
                    <li class="rec-item">
                      <span class="rec-bullet">&#8250;</span>
                      <span>{{ rec }}</span>
                    </li>
                  }
                </ul>
              </div>
            }

            <!-- ── Engineering detail (collapsible) ── -->
            <button type="button" class="detail-toggle" (click)="detailOpen.set(!detailOpen())">
              <span class="chev">{{ detailOpen() ? '▾' : '▸' }}</span>
              Engineering detail
              <span class="hint">requirements table · findings with evidence links · measurements · key events</span>
            </button>

            @if (detailOpen()) {

              <!-- Narrative -->
              @if (fr.summary?.narrative) {
                <div class="section">
                  <div class="section-title">What Happened During This Session</div>
                  <div class="prose">{{ fr.summary!.narrative }}</div>
                </div>
              }
              @if (fr.summary?.networkHealth || fr.summary?.faultAnalysis) {
                <div class="two-col">
                  @if (fr.summary?.networkHealth) {
                    <div class="section" style="margin-bottom:0">
                      <div class="section-title">CAN Bus Network Health</div>
                      <div class="prose">{{ fr.summary!.networkHealth }}</div>
                    </div>
                  }
                  @if (fr.summary?.faultAnalysis) {
                    <div class="section" style="margin-bottom:0">
                      <div class="section-title">Fault Analysis</div>
                      <div class="prose">{{ fr.summary!.faultAnalysis }}</div>
                    </div>
                  }
                </div>
              }

              <!-- Requirements verdict table -->
              <div class="section">
                <div class="section-title">Requirements Verdict</div>
                @if (fr.requirements; as req) {
                  @if (req.rules.length > 0) {
                    <table class="req-table">
                      <thead>
                        <tr>
                          <th>Rule</th><th>Title</th><th>Severity</th><th>Outcome</th>
                          <th>Pass</th><th>Violated</th><th>Timing</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (rule of sortedRules(); track rule.ruleId) {
                          <tr>
                            <td><span class="rule-chip">{{ rule.ruleId }}</span></td>
                            <td>{{ rule.title }}@if (rule.draft) { <span style="color:#e3b341"> (draft)</span> }</td>
                            <td><span class="badge" [class]="'badge sev-' + rule.severity">{{ rule.severity }}</span></td>
                            <td><span class="outcome" [class]="'outcome out-' + rule.outcome">{{ outcomeLabel(rule.outcome) }}</span></td>
                            <td>{{ rule.passCount }}</td>
                            <td>{{ rule.violatedCount }}</td>
                            <td>{{ rule.timingViolatedCount }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  } @else {
                    <div class="empty-note">No requirement sets are assigned to this session's car — assign sets on the Fleet page.</div>
                  }
                } @else {
                  <div class="empty-note">Requirements report unavailable for this session.</div>
                }
              </div>

              <!-- Requirement violations with evidence links -->
              @if (fr.requirementFindings.length > 0) {
                <div class="section">
                  <div class="section-title">Requirement Violations</div>
                  @for (f of fr.requirementFindings; track f.id) {
                    <div class="evidence-row" [style.border-left-color]="severityColor(f.ruleSeverity)">
                      <span class="badge" [class]="'badge sev-' + (f.ruleSeverity || 'INFO')">{{ f.ruleSeverity || 'INFO' }}</span>
                      <span class="msg-chip">{{ f.requirementId }}</span>
                      <span class="evidence-desc">{{ f.description }}</span>
                      @if ((f.occurrences ?? 1) > 1) { <span class="occ">×{{ f.occurrences }}</span> }
                      <span class="evidence-ts">{{ relTime(f.frameTimestamp) }}</span>
                      <span class="link-btns">
                        <button class="btn-link" (click)="viewFaultInCharts(f)"
                                title="Zoom the signal charts to this finding's window">Charts →</button>
                        @if (f.msgId) {
                          <button class="btn-link" (click)="viewFaultInTable(f)"
                                  title="Open the frame table filtered to this message's fault rows">☰ Table</button>
                        }
                        @if (f.frameTimestamp) {
                          <button class="btn-link" (click)="viewFaultInTwin(f)"
                                  title="Open the 3D twin at the moment of this finding">🚗 Twin {{ '@' }} {{ relTime(f.frameTimestamp) }}</button>
                        }
                      </span>
                    </div>
                  }
                </div>
              }

              <!-- Integrity findings grouped by type, with evidence links -->
              <div class="section">
                <div class="section-title">Integrity Findings</div>
                @if (faultGroups().length === 0) {
                  <div class="empty-note">✓ No integrity faults — every frame passed the built-in checks.</div>
                }
                @for (group of faultGroups(); track group.type) {
                  <div class="group-head">
                    <span [style.color]="group.color">{{ group.label }}</span>
                    <span class="group-count">{{ group.faults.length }}</span>
                  </div>
                  @for (f of group.faults.slice(0, maxFaultsPerGroup); track f.id) {
                    <div class="evidence-row" [style.border-left-color]="group.color">
                      <span class="evidence-desc">
                        {{ f.msgName }} <span class="msg-chip">{{ f.msgId }}</span> — {{ f.description }}
                      </span>
                      @if ((f.occurrences ?? 1) > 1) { <span class="occ">×{{ f.occurrences }}</span> }
                      <span class="evidence-ts">{{ relTime(f.frameTimestamp) }}</span>
                      <span class="link-btns">
                        <button class="btn-link" (click)="viewFaultInCharts(f)"
                                title="Zoom the signal charts to this finding's window">Charts →</button>
                        @if (f.msgId) {
                          <button class="btn-link" (click)="viewFaultInTable(f)"
                                  title="Open the frame table filtered to this message's fault rows">☰ Table</button>
                        }
                        @if (f.frameTimestamp) {
                          <button class="btn-link" (click)="viewFaultInTwin(f)"
                                  title="Open the 3D twin at the moment of this finding">🚗 Twin {{ '@' }} {{ relTime(f.frameTimestamp) }}</button>
                        }
                      </span>
                    </div>
                  }
                  @if (group.faults.length > maxFaultsPerGroup) {
                    <div class="more-note">… {{ group.faults.length - maxFaultsPerGroup }} more {{ group.label }} finding(s) — open the Checks tab for the full list.</div>
                  }
                }
              </div>

              <!-- Fault timeline -->
              @if (fr.summary; as s) {
                @if (s.faultBreakdown.timeline.length > 0 && s.durationSec > 0) {
                  <div class="section">
                    <div class="section-title">Fault Timeline</div>
                    <div class="timeline-wrap">
                      <svg viewBox="0 0 600 40" class="timeline-svg">
                        <rect x="20" y="15" width="560" height="10" rx="5" fill="#21262d"/>
                        @for (dot of timelineDots(s); track $index) {
                          <circle [attr.cx]="dot.x" cy="20" r="5" [attr.fill]="dot.color" opacity="0.85"/>
                        }
                      </svg>
                      <div class="timeline-labels">
                        <span>0 s</span>
                        <span>{{ (s.durationSec / 2) | number:'1.0-0' }} s</span>
                        <span>{{ s.durationSec | number:'1.0-0' }} s</span>
                      </div>
                      <div class="legend">
                        @if (s.faultBreakdown.duplicates > 0) {
                          <span class="legend-item"><span class="legend-dot" style="background:#fb923c"></span> Duplicate</span>
                        }
                        @if (s.faultBreakdown.timingGaps > 0) {
                          <span class="legend-item"><span class="legend-dot" style="background:#fbbf24"></span> Timing Gap</span>
                        }
                        @if (s.faultBreakdown.rangeViolations > 0) {
                          <span class="legend-item"><span class="legend-dot" style="background:#f87171"></span> Range Violation</span>
                        }
                      </div>
                    </div>
                  </div>
                }

                <!-- Signal measurements -->
                @if (s.signalStats.length > 0) {
                  <div class="section">
                    <div class="section-title">Signal Measurements</div>
                    <table class="signal-table">
                      <thead>
                        <tr><th>Signal</th><th>Samples</th><th>Min</th><th>Mean</th><th>Max</th></tr>
                      </thead>
                      <tbody>
                        @for (sig of s.signalStats; track sig.name) {
                          <tr>
                            <td class="sig-name">{{ sig.name }}</td>
                            <td>{{ sig.count | number }}</td>
                            <td>{{ sig.min | number:'1.2-2' }}</td>
                            <td>{{ sig.mean | number:'1.2-2' }}</td>
                            <td>{{ sig.max | number:'1.2-2' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }

                <!-- Key events with evidence links -->
                @if (s.keyEvents.length > 0) {
                  <div class="section">
                    <div class="section-title">Key Events</div>
                    @for (ev of s.keyEvents; track $index) {
                      <div class="evidence-row" style="border-left-color:#b0ff44">
                        <span class="event-time">{{ ev.time }}</span>
                        <span class="evidence-desc">{{ ev.description }}</span>
                        @if (eventRelSec(ev.time) !== null) {
                          <span class="link-btns">
                            <button class="btn-link" (click)="viewEventInCharts(ev.time)"
                                    title="Zoom the signal charts around this moment">Charts →</button>
                            <button class="btn-link" (click)="viewEventInTwin(ev.time)"
                                    title="Open the 3D twin at this moment">🚗 Twin {{ '@' }} {{ ev.time }}</button>
                          </span>
                        }
                      </div>
                    }
                  </div>
                }

                <!-- Full recommendations when more than the top-3 exist -->
                @if (s.recommendations.length > 3) {
                  <div class="section">
                    <div class="section-title">All Recommendations</div>
                    <ul class="recs-list">
                      @for (rec of s.recommendations; track $index) {
                        <li class="rec-item">
                          <span class="rec-bullet">&#8250;</span>
                          <span>{{ rec }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                }
              }
            }

            <!-- ── NL follow-up ── -->
            <div class="ask-block">
              <app-nl-ask
                placeholder="Ask a follow-up about this session…"
                [scope]="'for session ' + sessionId" />
            </div>

            @if (fr.summary; as s) {
              <div class="report-footer">
                <span>Generated {{ s.generatedAt | date:'d MMM yyyy, HH:mm' }}</span>
                <span class="model-chip">{{ s.modelUsed }}</span>
              </div>
            }
          }
        }
      }
    </div>
  `,
})
export class ReportTabComponent implements OnChanges {
  @Input({ required: true }) sessionId = '';
  /** Session row from the inspector — supplies startTs for relative times / twin seeks. */
  @Input() session: CanSession | null = null;

  /** Open the Table tab filtered to this message's fault rows. */
  readonly viewTable = output<{ msgId: string }>();
  /** Open the 3D Twin tab and seek its replay to t (seconds from session start). */
  readonly viewTwin = output<{ t: number }>();

  private summaryService = inject(SessionSummaryService);
  private faultReport    = inject(FaultReportService);
  private canService     = inject(CanService);
  private findingFocus   = inject(FindingFocusService);
  private destroyRef     = inject(DestroyRef);

  readonly healthTooltip = HEALTH_SCORE_TOOLTIP;
  readonly maxFaultsPerGroup = 8;

  state      = signal<ReportState>('loading');
  fullReport = signal<FullReport | null>(null);
  generating = signal(false);
  detailOpen = signal(false);

  /** Findings currently in the session (all layers) — compared against the summary basis. */
  readonly currentFindingCount = computed(() => {
    const fr = this.fullReport();
    if (!fr) return 0;
    return fr.specFaultCount + fr.requirementFindings.length;
  });

  readonly currentRuleCount = computed(() => this.fullReport()?.requirements?.totalRules ?? 0);

  /** Amber banner: the generated summary no longer matches the session's data. */
  readonly isStale = computed(() => {
    const s = this.fullReport()?.summary;
    if (!s) return false;
    return s.errorCount !== this.currentFindingCount()
      || (s.ruleCount ?? 0) !== this.currentRuleCount();
  });

  readonly provenance = computed(() =>
    FaultReportService.provenanceLabel(this.fullReport()?.summary ?? null));

  readonly trendLabel = computed(() =>
    FaultReportService.trendLabel(
      this.fullReport()?.summary?.healthScore, this.fullReport()?.history));

  /** Requirements rows: violated first, then timing, pass, not-tested. */
  readonly sortedRules = computed<RuleReport[]>(() => {
    const order: Record<string, number> = { VIOLATED: 0, TIMING_VIOLATED: 1, PASS: 2, NOT_TESTED: 3 };
    return [...(this.fullReport()?.requirements?.rules ?? [])]
      .sort((a, b) => (order[a.outcome] ?? 9) - (order[b.outcome] ?? 9));
  });

  /** Integrity findings grouped by type (backend order: worst types first). */
  readonly faultGroups = computed(() => {
    const byType = this.fullReport()?.faultsByType ?? {};
    return Object.entries(byType).map(([type, faults]) => ({
      type,
      label: FAULT_TYPE_META[type]?.label ?? type,
      color: FAULT_TYPE_META[type]?.color ?? '#8a9ab0',
      faults,
    }));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sessionId'] && this.sessionId) {
      this.loadReport();
    }
  }

  loadReport(): void {
    this.state.set('loading');
    this.canService.getFullReport(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next:  (fr) => { this.fullReport.set(fr); this.state.set('loaded'); },
        error: ()   => { this.fullReport.set(null); this.state.set('error'); },
      });
  }

  /** Quiet reload after a regenerate — keeps the page up while refreshing. */
  private reloadQuiet(): void {
    this.canService.getFullReport(this.sessionId)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((fr) => { if (fr) this.fullReport.set(fr); });
  }

  generate(): void {
    if (this.generating()) return;
    this.generating.set(true);
    this.summaryService.generate(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next:  () => this.pollForSummary(),
        error: () => this.generating.set(false),
      });
  }

  private pollForSummary(): void {
    const startedAt = Date.now();
    interval(2000).pipe(
      take(15),
      switchMap(() => this.summaryService.getQuiet(this.sessionId).pipe(catchError(() => of(null)))),
      filter((s): s is SessionSummary =>
        s !== null && new Date(s.generatedAt).getTime() >= startedAt - 60_000),
      take(1),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next:     () => { this.generating.set(false); this.reloadQuiet(); },
      complete: () => this.generating.set(false),
    });
  }

  // ── Evidence deep-links (cross-view navigation) ───────────────────────────

  /** Publish the finding's window + signals; the inspector switches to Charts. */
  viewFaultInCharts(f: IntegrityFault): void {
    const ev = f.evidence as Record<string, unknown> | null | undefined;
    const raw = ev?.['triggerTs'] ?? ev?.['enteredTs'];
    const start = typeof raw === 'number' ? raw : (f.frameTimestamp ?? 0);
    const end = Math.max(f.frameTimestamp ?? start, f.lastSeenTs ?? 0, start);
    const signals = Array.isArray(ev?.['signals'])
      ? (ev!['signals'] as unknown[]).map(String)
      : f.signalName ? [f.signalName] : [];
    this.findingFocus.set({
      start, end, signals,
      label: f.requirementId ?? f.faultType,
      sessionId: this.sessionId,
    });
  }

  viewClusterInCharts(c: { windowStart: number; windowEnd: number; label: string }): void {
    this.findingFocus.set({
      start: c.windowStart, end: c.windowEnd, signals: [],
      label: c.label, sessionId: this.sessionId,
    });
  }

  /** Table tab: the ⚠ row correlates by msgId+timestamp — filter to the message, faults only. */
  viewFaultInTable(f: IntegrityFault): void {
    this.viewTable.emit({ msgId: f.msgId });
  }

  viewFaultInTwin(f: IntegrityFault): void {
    const t = this.toRelSec(f.frameTimestamp);
    if (t !== null) this.viewTwin.emit({ t });
  }

  viewEventInCharts(time: string): void {
    const rel = this.eventRelSec(time);
    const startTs = this.sessionStart();
    if (rel === null || startTs === null) return;
    this.findingFocus.set({
      start: startTs + Math.max(0, rel - 3),
      end: startTs + rel + 3,
      signals: [],
      label: `Key event ${time}`,
      sessionId: this.sessionId,
    });
  }

  viewEventInTwin(time: string): void {
    const rel = this.eventRelSec(time);
    if (rel !== null) this.viewTwin.emit({ t: rel });
  }

  /** "+M:SS.s" → seconds from session start; null when unparseable. */
  eventRelSec(time: string): number | null {
    const m = /\+?\s*(\d+):(\d+(?:\.\d+)?)/.exec(time ?? '');
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  }

  private sessionStart(): number | null {
    const s = this.session;
    if (s?.startTs) return s.startTs;
    // Fallback: anchor to the earliest fault timestamp in the report.
    const fr = this.fullReport();
    const allTs = [
      ...Object.values(fr?.faultsByType ?? {}).flat(),
      ...(fr?.requirementFindings ?? []),
    ].map((f) => f.frameTimestamp).filter((t): t is number => !!t);
    return allTs.length ? Math.min(...allTs) : null;
  }

  private toRelSec(absTs: number | null | undefined): number | null {
    const start = this.sessionStart();
    if (absTs == null || start === null) return null;
    return Math.max(0, absTs - start);
  }

  /** "+M:SS" label of a fault relative to session start (falls back to wall time). */
  relTime(absTs: number | null | undefined): string {
    const rel = this.toRelSec(absTs);
    if (rel === null) return absTs ? new Date(absTs * 1000).toLocaleTimeString() : '';
    const m = Math.floor(rel / 60);
    const s = (rel % 60).toFixed(1);
    return `+${m}:${s.padStart(4, '0')}`;
  }

  // ── Rendering helpers ─────────────────────────────────────────────────────

  outcomeLabel(outcome: string): string {
    return outcome.replace('_', ' ');
  }

  severityColor(sev: string | null | undefined): string {
    switch (sev) {
      case 'CRITICAL': return '#ff4444';
      case 'HIGH': return '#ff8c42';
      case 'MEDIUM': return '#e3b341';
      case 'LOW': return '#58a6ff';
      default: return '#8a9ab0';
    }
  }

  ringColor(score: number): string {
    if (score >= 90) return '#b0ff44';
    if (score >= 75) return '#68d391';
    if (score >= 60) return '#f6c90e';
    if (score >= 40) return '#f97316';
    return '#ff4444';
  }

  formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  timelineDots(s: SessionSummary): TimelineDot[] {
    if (!s.faultBreakdown.timeline.length || !s.durationSec) return [];
    return s.faultBreakdown.timeline.map((pt: FaultPoint) => ({
      x: 20 + Math.min(1, Math.max(0, pt.relTimeSec / s.durationSec)) * 560,
      color: FAULT_TYPE_META[pt.type]?.color ?? '#f87171',
      type: pt.type,
    }));
  }

  /**
   * Prints the SAME unified composition the tab renders. The Twin tab's Export
   * Report goes through the same path and only adds its viewport snapshot.
   */
  downloadPdf(): void {
    const fr = this.fullReport();
    if (!fr) return;
    this.faultReport.download({
      sessionId: this.sessionId,
      sessionName: this.session?.sourceFilename ?? this.sessionId,
      vehicle: fr.vehicle ?? undefined,
      summary: fr.summary,
      report: fr.diagnostics,
      vehicleState: fr.vehicleState.length ? fr.vehicleState : undefined,
      verdict: fr.overallVerdict,
      specFaultCount: fr.specFaultCount,
      requirementViolationCount: fr.requirementViolationCount,
      requirements: fr.requirements,
      clusters: fr.clusters,
      provenance: this.provenance(),
      trendLabel: this.trendLabel(),
    });
  }
}
