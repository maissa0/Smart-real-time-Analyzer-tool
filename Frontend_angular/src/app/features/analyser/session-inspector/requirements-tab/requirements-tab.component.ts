import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CanService } from '../../../../core/services/can.service';
import { FindingFocusService } from '../../../../core/services/finding-focus.service';
import { RequirementService } from '../../../../core/services/requirement.service';
import { RequirementReport, RuleReport } from '../../../../core/models/requirement.model';
import {
  FindingCluster,
  IntegrityFault,
  SupportingMlRef,
} from '../../../../core/models/can.model';
import { NlAskComponent } from '../../../../shared/components/nl-ask/nl-ask.component';

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4,
};

/** Built-in spec checks shown in the rail, severity-first, with the
 *  plain-language explanation used across the app. */
interface SpecCheckMeta {
  type: string;
  label: string;
  icon: string;
  color: string;
  desc: string;
}
const SPEC_CHECKS: SpecCheckMeta[] = [
  { type: 'SIGNAL_RANGE', label: 'Range Violation', icon: '⚠', color: '#f87171',
    desc: 'A signal carried a value outside its allowed catalogue set' },
  { type: 'COUNTER_ERROR', label: 'Counter Error', icon: '#', color: '#c084fc',
    desc: 'The frame counter skipped ahead — frames were lost' },
  { type: 'SEQUENCE_REGRESSION', label: 'Counter Reset', icon: '↺', color: '#e879f9',
    desc: 'The frame counter went backwards — replay or ECU reset' },
  { type: 'TIMING_GAP', label: 'Timing Gap', icon: '⏱', color: '#fbbf24',
    desc: 'A periodic message arrived later than 3× its expected cycle' },
  { type: 'DUPLICATE', label: 'Duplicate', icon: '⧉', color: '#fb923c',
    desc: 'The exact same frame arrived twice within 1 ms' },
  { type: 'MESSAGE_TIMEOUT', label: 'Message Timeout', icon: '⌛', color: '#22d3ee',
    desc: 'A periodic message went silent — ECU stopped transmitting or the stream ended' },
];

type CheckSelection =
  | { kind: 'check'; type: string }
  | { kind: 'rule'; id: string };

/**
 * Merged Integrity + Requirements tab ("Checks"): a session verdict banner on
 * top, then a test-runner master-detail — every built-in integrity check and
 * every user requirement listed on the left with PASS/FAIL, the selected
 * item's findings and explanations on the right.
 */
@Component({
  selector: 'app-requirements-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, NlAskComponent],
  styles: [`
    :host { display: block; overflow-y: auto; padding: 1rem 1.25rem; background: #07090b; }
    .ask-block { margin-bottom: 0.9rem; }

    /* ── Verdict banner ── */
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
    .tiles { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-left: auto; }
    .tile { text-align: center; min-width: 74px; padding: 0.3rem 0.6rem; border-radius: 8px;
      background: #07090b; border: 1px solid rgba(255,255,255,0.06); }
    .tile-v { font-size: 0.95rem; font-weight: 700; color: #e6edf3; }
    .tile-l { font-size: 0.58rem; color: #8a9ab0; text-transform: uppercase; letter-spacing: 0.05em; }
    .tile-pass .tile-v { color: #3fb950; }
    .tile-viol .tile-v { color: #ff4444; }
    .tile-timing .tile-v { color: #ff8c42; }
    .tile-spec .tile-v { color: #fbbf24; }
    .live-chip {
      padding: 3px 9px; border-radius: 10px; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.05em;
    }
    .live-yes { background: rgba(176,255,68,0.15); color: #b0ff44; }
    .live-no { background: rgba(72,79,88,0.2); color: #8a9ab0; }
    .btn-refresh {
      padding: 4px 12px; border-radius: 6px; font-size: 0.72rem; font-weight: 600;
      border: 1px solid rgba(176,255,68,0.25); background: transparent; color: #b0ff44;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-refresh:hover { background: rgba(176,255,68,0.08); }

    .section-title {
      font-size: 0.72rem; font-weight: 700; color: #8a9ab0; text-transform: uppercase;
      letter-spacing: 0.08em; margin: 0 0 0.55rem;
    }
    .cluster-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
    .cluster-chip {
      display: inline-flex; align-items: center; gap: 0.45rem;
      background: #0d1117; border: 1px solid rgba(255,140,66,0.35); border-radius: 10px;
      padding: 0.45rem 0.8rem; font-size: 0.74rem; color: #e6edf3;
    }
    .cluster-chip .cluster-sev {
      padding: 2px 7px; border-radius: 4px; font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em;
    }
    .cluster-occ { color: #8a9ab0; font-size: 0.66rem; }

    /* ── Rule-runner layout ── */
    .runner { display: flex; gap: 0.9rem; align-items: flex-start; }
    .rail { width: 290px; flex: none; display: flex; flex-direction: column; gap: 2px; }
    .rail-section {
      font-size: 0.62rem; font-weight: 700; color: #8a9ab0; text-transform: uppercase;
      letter-spacing: 0.08em; margin: 0.7rem 0 0.3rem; padding-left: 0.25rem;
    }
    .rail-section:first-child { margin-top: 0; }
    .rail-item {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.6rem;
      border-radius: 8px; cursor: pointer; border: 1px solid transparent; text-align: left;
      background: transparent; width: 100%;
    }
    .rail-item:hover { background: #0d1117; }
    .rail-item.active { background: #0d1117; border-color: rgba(176,255,68,0.35); }
    .rail-icon { width: 16px; text-align: center; font-size: 0.78rem; flex: none; }
    .rail-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; display: inline-block; }
    .rail-label {
      flex: 1; min-width: 0; font-size: 0.72rem; color: #e6edf3;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .rail-sub { display: block; font-size: 0.6rem; color: #484f58; font-family: monospace; }
    .pill {
      flex: none; padding: 2px 8px; border-radius: 10px; font-size: 0.6rem;
      font-weight: 700; letter-spacing: 0.04em; white-space: nowrap;
    }
    .pill-pass { background: rgba(63,185,80,0.15); color: #3fb950; }
    .pill-fail { background: rgba(255,68,68,0.15); color: #ff4444; }
    .pill-timing { background: rgba(255,140,66,0.15); color: #ff8c42; }
    .pill-nt { background: rgba(72,79,88,0.2); color: #8a9ab0; }
    .rail-empty { font-size: 0.66rem; color: #484f58; padding: 0.3rem 0.6rem; }

    /* ── Detail pane ── */
    .detail { flex: 1; min-width: 0; }
    .detail-head {
      background: #0d1117; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
      padding: 0.7rem 0.9rem; margin-bottom: 0.6rem;
    }
    .dh-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
    .dh-title { font-size: 0.85rem; font-weight: 700; color: #e6edf3; }
    .dh-desc { font-size: 0.72rem; color: #8a9ab0; margin-top: 0.3rem; line-height: 1.4; }
    .dh-stats { display: flex; gap: 1rem; margin-top: 0.4rem; font-size: 0.66rem; color: #8a9ab0; flex-wrap: wrap; }
    .dh-stats b { color: #e6edf3; font-weight: 600; }
    .all-pass {
      display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
      padding: 2.5rem 1rem; text-align: center; color: #3fb950;
      border: 1px dashed rgba(63,185,80,0.3); border-radius: 10px; font-size: 0.8rem;
    }
    .all-pass .big { font-size: 1.6rem; }
    .all-pass .sub { color: #8a9ab0; font-size: 0.7rem; }

    .badge {
      padding: 2px 8px; border-radius: 4px; font-size: 0.6rem; font-weight: 700;
      letter-spacing: 0.05em; white-space: nowrap;
    }
    .sev-CRITICAL { background: rgba(255,68,68,0.18); color: #ff4444; }
    .sev-HIGH { background: rgba(255,140,66,0.15); color: #ff8c42; }
    .sev-MEDIUM { background: rgba(227,179,65,0.14); color: #e3b341; }
    .sev-LOW { background: rgba(88,166,255,0.12); color: #58a6ff; }
    .sev-INFO { background: rgba(138,154,176,0.15); color: #8a9ab0; }
    .rule-chip {
      font-family: monospace; font-size: 0.68rem; font-weight: 700; color: #b0ff44;
      background: rgba(176,255,68,0.1); padding: 2px 8px; border-radius: 4px;
    }
    .type-chip { background: rgba(255,68,68,0.1); color: #ff6b6b; }
    .type-chip.timing { background: rgba(255,140,66,0.12); color: #ff8c42; }
    .outcome {
      padding: 2px 8px; border-radius: 4px; font-size: 0.62rem; font-weight: 700;
      letter-spacing: 0.04em; white-space: nowrap;
    }
    .out-PASS { background: rgba(63,185,80,0.15); color: #3fb950; }
    .out-VIOLATED { background: rgba(255,68,68,0.15); color: #ff4444; }
    .out-TIMING_VIOLATED { background: rgba(255,140,66,0.15); color: #ff8c42; }
    .out-NOT_TESTED { background: rgba(72,79,88,0.2); color: #8a9ab0; }
    .chip-draft {
      padding: 2px 6px; border-radius: 4px; font-size: 0.58rem; font-weight: 700;
      background: rgba(227,179,65,0.12); color: #e3b341;
    }

    .finding-card {
      background: #0d1117; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
      padding: 0.7rem 0.9rem; margin-bottom: 0.55rem; border-left: 3px solid #484f58;
    }
    .fc-CRITICAL { border-left-color: #ff4444; }
    .fc-HIGH { border-left-color: #ff8c42; }
    .fc-MEDIUM { border-left-color: #e3b341; }
    .fc-LOW { border-left-color: #58a6ff; }
    .fc-INFO { border-left-color: #8a9ab0; }
    .finding-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; cursor: pointer; }
    .finding-title { font-size: 0.78rem; color: #e6edf3; flex: 1; min-width: 200px; }
    .msg-chip { font-family: monospace; font-size: 0.66rem; color: #b0ff44; }
    .occ {
      font-size: 0.65rem; color: #8a9ab0; background: rgba(72,79,88,0.25);
      padding: 2px 8px; border-radius: 10px; font-weight: 600;
    }
    .finding-ts { font-size: 0.65rem; color: #484f58; font-family: monospace; }
    .btn-chart {
      background: none; border: 1px solid rgba(176,255,68,0.25); border-radius: 5px;
      color: #b0ff44; font-size: 0.65rem; font-weight: 600; padding: 2px 8px;
      cursor: pointer; transition: all 0.15s; white-space: nowrap;
    }
    .btn-chart:hover { background: rgba(176,255,68,0.08); }
    .chev { font-size: 0.6rem; color: #484f58; }

    .finding-body {
      margin-top: 0.55rem; padding-top: 0.55rem; border-top: 1px solid rgba(255,255,255,0.06);
      display: flex; flex-direction: column; gap: 0.45rem;
    }
    .explain-grid { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .explain-box { background: rgba(0,0,0,0.25); border-radius: 8px; padding: 0.5rem 0.6rem; }
    .explain-k {
      font-size: 0.58rem; font-weight: 700; color: #8a9ab0; text-transform: uppercase;
      letter-spacing: 0.06em; margin-bottom: 0.2rem;
    }
    .explain-v { font-size: 0.7rem; color: #b8c4d0; line-height: 1.35; }
    .ctx-row { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .ctx-chip {
      padding: 1px 7px; border-radius: 4px; background: rgba(72,79,88,0.25);
      font-size: 0.62rem; font-family: monospace; color: #8a9ab0;
    }
    .ctx-chip b { color: #e6edf3; font-weight: 600; }
    .ev-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.9rem; }
    .ev-k { font-size: 0.68rem; color: #8a9ab0; font-family: monospace; }
    .ev-v { font-size: 0.68rem; color: #e6edf3; font-family: monospace; word-break: break-all; }
    .check-title { font-size: 0.68rem; font-weight: 700; color: #8a9ab0; }
    .check-list { margin: 0; padding-left: 1.1rem; }
    .check-list li { font-size: 0.7rem; color: #b8c4d0; margin-bottom: 0.12rem; }
    .ml-support-title {
      display: block; font-size: 0.66rem; font-weight: 700; color: #b0ff44;
      text-transform: uppercase; letter-spacing: 0.06em; margin: 0.2rem 0 0.1rem;
    }
    .ml-support { list-style: none; margin: 0; padding: 0; }
    .ml-support li { font-size: 0.72rem; color: #8a9ab0; padding: 2px 0; }
    .ml-support .ml-type { color: #b0ff44; font-family: monospace; margin-right: 0.4rem; }

    .empty {
      color: #8a9ab0; font-size: 0.78rem; padding: 2rem 0; text-align: center;
      border: 1px dashed rgba(176,255,68,0.15); border-radius: 10px;
    }
    .spinner {
      width: 18px; height: 18px; border: 2px solid #21262d; border-top-color: #b0ff44;
      border-radius: 50%; animation: spin 0.8s linear infinite; margin: 2rem auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
  template: `
    @if (loading()) {
      <div class="spinner"></div>
    } @else {

      <!-- ── Verdict banner ── -->
      <div class="verdict" [class.verdict-pass]="!verdictFailed()" [class.verdict-fail]="verdictFailed()">
        <span class="verdict-badge">{{ verdictFailed() ? 'CHECKS FAILED' : 'CHECKS PASSED' }}</span>
        <span class="verdict-sub">
          {{ specFaults().length }} integrity finding{{ specFaults().length === 1 ? '' : 's' }}
          · {{ reqViolationCount() }} requirement violation{{ reqViolationCount() === 1 ? '' : 's' }}
        </span>
        <div class="tiles">
          <div class="tile tile-spec"><div class="tile-v">{{ specFaults().length }}</div><div class="tile-l">Integrity</div></div>
          @if (report(); as r) {
            <div class="tile"><div class="tile-v">{{ r.totalRules }}</div><div class="tile-l">Rules</div></div>
            <div class="tile tile-pass"><div class="tile-v">{{ r.passed }}</div><div class="tile-l">Passed</div></div>
            <div class="tile tile-viol"><div class="tile-v">{{ r.violated }}</div><div class="tile-l">Violated</div></div>
            <div class="tile tile-timing"><div class="tile-v">{{ r.timingViolated }}</div><div class="tile-l">Timing</div></div>
            <div class="tile"><div class="tile-v">{{ r.notTested }}</div><div class="tile-l">Not tested</div></div>
          }
        </div>
        @if (report(); as r) {
          <span class="live-chip" [class.live-yes]="r.live" [class.live-no]="!r.live">
            {{ r.live ? 'LIVE' : 'FROM DB' }}
          </span>
        }
        <button class="btn-refresh" (click)="load()">Refresh</button>
      </div>

      <div class="ask-block">
        <app-nl-ask
          placeholder="Ask about this session — e.g. 'show all timing gaps' or 'when was the first duplicate?'"
          [scope]="'for session ' + sessionId()" />
      </div>

      @if (clusters().length > 0) {
        <div class="section-title">Probable root causes</div>
        <div class="cluster-row">
          @for (c of clusters(); track c.clusterId) {
            <span class="cluster-chip">
              <span class="cluster-sev" [class]="'cluster-sev sev-' + c.topSeverity">{{ c.topSeverity }}</span>
              {{ c.label }}
              @if (c.totalOccurrences > c.findingCount) {
                <span class="cluster-occ">({{ c.totalOccurrences }} occurrences)</span>
              }
            </span>
          }
        </div>
      }

      <!-- ── Rule runner: checks rail + detail ── -->
      <div class="runner">
        <div class="rail">
          <div class="rail-section">Built-in integrity checks</div>
          @for (check of specChecks(); track check.type) {
            <button type="button" class="rail-item" [class.active]="isCheckSelected(check.type)"
              (click)="selectCheck(check.type)">
              <span class="rail-dot" [style.background]="check.color"></span>
              <span class="rail-label">{{ check.label }}</span>
              @if (check.count === 0) {
                <span class="pill pill-pass">PASS</span>
              } @else {
                <span class="pill pill-fail">{{ check.count }}</span>
              }
            </button>
          }

          <div class="rail-section">My requirements</div>
          @if (!report() || report()!.totalRules === 0) {
            <div class="rail-empty">
              No requirement sets assigned to this session's car — assign sets on the Fleet page.
            </div>
          } @else {
            @for (rule of sortedRules(); track rule.ruleId) {
              <button type="button" class="rail-item" [class.active]="isRuleSelected(rule.ruleId)"
                (click)="selectRule(rule.ruleId)">
                <span class="rail-icon badge" [class]="'rail-icon badge sev-' + rule.severity"
                  style="width:auto">{{ rule.severity.charAt(0) }}</span>
                <span class="rail-label">{{ rule.title }}
                  <span class="rail-sub">{{ rule.ruleId }}</span>
                </span>
                @switch (rule.outcome) {
                  @case ('PASS') { <span class="pill pill-pass">PASS</span> }
                  @case ('VIOLATED') { <span class="pill pill-fail">{{ rule.violatedCount || 'FAIL' }}</span> }
                  @case ('TIMING_VIOLATED') { <span class="pill pill-timing">{{ rule.timingViolatedCount || 'TIME' }}</span> }
                  @default { <span class="pill pill-nt">N/T</span> }
                }
              </button>
            }
          }
        </div>

        <div class="detail">
          @if (selectedCheckDetail(); as d) {
            <!-- Built-in check detail -->
            <div class="detail-head">
              <div class="dh-row">
                <span class="rail-dot" [style.background]="d.meta.color"></span>
                <span class="dh-title">{{ d.meta.label }}</span>
                @if (d.faults.length === 0) { <span class="pill pill-pass">PASS</span> }
                @else { <span class="pill pill-fail">{{ d.faults.length }} finding{{ d.faults.length === 1 ? '' : 's' }}</span> }
              </div>
              <div class="dh-desc">{{ d.meta.desc }}.</div>
            </div>
            @if (d.faults.length === 0) {
              <div class="all-pass">
                <span class="big">✓</span>
                <span>Every frame passed this check.</span>
              </div>
            }
            @for (f of d.faults; track f.id) {
              <div class="finding-card" [style.border-left-color]="d.meta.color">
                <div class="finding-head" (click)="toggleFinding(f.id)">
                  <span class="finding-title">{{ f.msgName }} <span class="msg-chip">{{ f.msgId }}</span></span>
                  @if ((f.occurrences ?? 1) > 1) { <span class="occ">×{{ f.occurrences }}</span> }
                  <span class="finding-ts">{{ formatTs(f.frameTimestamp) }}</span>
                  <span class="chev">{{ expandedFindings().has(f.id) ? '▾' : '▸' }}</span>
                </div>
                @if (expandedFindings().has(f.id)) {
                  <div class="finding-body">
                    <span class="ev-v">{{ f.description }}</span>
                    <div class="explain-grid">
                      <div class="explain-box">
                        <div class="explain-k">What it means</div>
                        <div class="explain-v">{{ f.meaning || d.meta.desc }}</div>
                      </div>
                      @if (f.likelyCause) {
                        <div class="explain-box">
                          <div class="explain-k">Likely cause</div>
                          <div class="explain-v">{{ f.likelyCause }}</div>
                        </div>
                      }
                      @if (f.whatToCheck) {
                        <div class="explain-box">
                          <div class="explain-k">What to check</div>
                          <div class="explain-v">{{ f.whatToCheck }}</div>
                        </div>
                      }
                    </div>
                    @if (f.context && f.context.length > 0) {
                      <span class="check-title">Vehicle state at detection</span>
                      <div class="ctx-row">
                        @for (c of f.context; track c.name) {
                          <span class="ctx-chip">{{ c.name }}: <b>{{ c.label || c.value }}</b></span>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }
          } @else if (selectedRuleDetail(); as d) {
            <!-- Requirement detail -->
            <div class="detail-head">
              <div class="dh-row">
                <span class="rule-chip">{{ d.rule.ruleId }}</span>
                <span class="dh-title">{{ d.rule.title }}</span>
                @if (d.rule.draft) { <span class="chip-draft">DRAFT</span> }
                <span class="badge" [class]="'badge sev-' + d.rule.severity">{{ d.rule.severity }}</span>
                <span class="outcome" [class]="'outcome out-' + d.rule.outcome">{{ d.rule.outcome }}</span>
              </div>
              <div class="dh-stats">
                <span>Kind: <b>{{ d.rule.kind }}</b></span>
                <span>Passed <b>{{ d.rule.passCount }}</b> times</span>
                <span>Violated <b>{{ d.rule.violatedCount }}</b></span>
                <span>Timing violations <b>{{ d.rule.timingViolatedCount }}</b></span>
              </div>
            </div>
            @if (d.findings.length === 0) {
              <div class="all-pass">
                <span class="big">{{ d.rule.outcome === 'NOT_TESTED' ? '—' : '✓' }}</span>
                <span>{{ d.rule.outcome === 'NOT_TESTED'
                  ? 'This rule was never exercised in this session.'
                  : 'This requirement held for the whole session.' }}</span>
              </div>
            }
            @for (f of d.findings; track f.id) {
              <div class="finding-card" [class]="'finding-card fc-' + (f.ruleSeverity || 'INFO')">
                <div class="finding-head" (click)="toggleFinding(f.id)">
                  <span class="badge type-chip" [class.timing]="f.faultType === 'REQUIREMENT_TIMING_VIOLATED'">
                    {{ typeLabel(f.faultType) }}
                  </span>
                  <span class="finding-title">{{ f.description }}</span>
                  @if ((f.occurrences ?? 1) > 1) { <span class="occ">×{{ f.occurrences }}</span> }
                  <span class="finding-ts">{{ formatTs(f.frameTimestamp) }}</span>
                  <button class="btn-chart" (click)="viewInCharts(f, $event)"
                    title="Zoom the signal charts to this finding's window">
                    📈 Charts
                  </button>
                  <span class="chev">{{ expandedFindings().has(f.id) ? '▾' : '▸' }}</span>
                </div>
                @if (expandedFindings().has(f.id)) {
                  <div class="finding-body">
                    @if (evidenceEntries(f).length > 0) {
                      <div class="ev-grid">
                        @for (e of evidenceEntries(f); track e[0]) {
                          <span class="ev-k">{{ e[0] }}</span>
                          <span class="ev-v">{{ e[1] }}</span>
                        }
                      </div>
                    }
                    @if (f.checkList && f.checkList.length > 0) {
                      <span class="check-title">What to check</span>
                      <ul class="check-list">
                        @for (c of f.checkList; track c) { <li>{{ c }}</li> }
                      </ul>
                    }
                    @if (supportingMl(f).length > 0) {
                      <span class="ml-support-title">Supporting ML evidence</span>
                      <ul class="ml-support">
                        @for (m of supportingMl(f); track m.findingId) {
                          <li>
                            <span class="ml-type">{{ m.faultType }}</span>
                            {{ m.description }} — {{ formatTs(m.ts) }}
                          </li>
                        }
                      </ul>
                    }
                  </div>
                }
              </div>
            }
          } @else {
            <div class="all-pass">
              <span class="big">✓</span>
              <span>All integrity checks and requirements passed.</span>
              <span class="sub">Select any check or rule on the left to inspect it.</span>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class RequirementsTabComponent {
  private requirementService = inject(RequirementService);
  private canService = inject(CanService);
  private findingFocus = inject(FindingFocusService);

  sessionId = input.required<string>();

  readonly report = signal<RequirementReport | null>(null);
  readonly allFaults = signal<IntegrityFault[]>([]);
  readonly clusters = signal<FindingCluster[]>([]);
  readonly loading = signal(true);
  readonly expandedFindings = signal<Set<number>>(new Set());

  /** User's explicit rail selection; null = auto-select the first failure. */
  readonly selected = signal<CheckSelection | null>(null);

  /** Spec-layer faults (everything the integrity analyzer raised). */
  readonly specFaults = computed(() =>
    this.allFaults().filter((f) => f.layer !== 'REQUIREMENT'));

  /** REQUIREMENT-layer findings, severity-sorted. */
  readonly findings = computed(() =>
    this.allFaults()
      .filter((f) => f.layer === 'REQUIREMENT')
      .sort((a, b) =>
        (SEVERITY_ORDER[a.ruleSeverity ?? 'INFO'] ?? 9) -
        (SEVERITY_ORDER[b.ruleSeverity ?? 'INFO'] ?? 9))
  );

  readonly reqViolationCount = computed(() => this.findings().length);

  readonly verdictFailed = computed(() => {
    const r = this.report();
    return this.specFaults().length > 0 ||
      (r != null && (r.violated > 0 || r.timingViolated > 0));
  });

  /** Rail entries for the built-in checks: known types first, then any
   *  fault type the analyzer raised that we have no meta for. */
  readonly specChecks = computed(() => {
    const byType = new Map<string, IntegrityFault[]>();
    for (const f of this.specFaults()) {
      const list = byType.get(f.faultType) ?? [];
      list.push(f);
      byType.set(f.faultType, list);
    }
    const known = SPEC_CHECKS.map((meta) => ({
      ...meta,
      count: byType.get(meta.type)?.length ?? 0,
    }));
    const extra = [...byType.keys()]
      .filter((t) => !SPEC_CHECKS.some((m) => m.type === t))
      .map((t) => ({
        type: t, label: t, icon: '•', color: '#8a9ab0', desc: '',
        count: byType.get(t)!.length,
      }));
    return [...known, ...extra];
  });

  /** Report rows: violated first, then timing, pass, not-tested. */
  readonly sortedRules = computed(() => {
    const order: Record<string, number> = {
      VIOLATED: 0, TIMING_VIOLATED: 1, PASS: 2, NOT_TESTED: 3,
    };
    return [...(this.report()?.rules ?? [])].sort(
      (a: RuleReport, b: RuleReport) =>
        (order[a.outcome] ?? 9) - (order[b.outcome] ?? 9) ||
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    );
  });

  /** What the detail pane shows: the user's pick, else the first failure. */
  readonly effectiveSelection = computed<CheckSelection | null>(() => {
    const picked = this.selected();
    if (picked) return picked;
    const failingCheck = this.specChecks().find((c) => c.count > 0);
    if (failingCheck) return { kind: 'check', type: failingCheck.type };
    const failingRule = this.sortedRules().find(
      (r) => r.outcome === 'VIOLATED' || r.outcome === 'TIMING_VIOLATED');
    if (failingRule) return { kind: 'rule', id: failingRule.ruleId };
    return null;
  });

  readonly selectedCheckDetail = computed(() => {
    const sel = this.effectiveSelection();
    if (!sel || sel.kind !== 'check') return null;
    const meta = this.specChecks().find((c) => c.type === sel.type);
    if (!meta) return null;
    const faults = this.specFaults()
      .filter((f) => f.faultType === sel.type)
      .sort((a, b) => a.frameTimestamp - b.frameTimestamp);
    return { meta, faults };
  });

  readonly selectedRuleDetail = computed(() => {
    const sel = this.effectiveSelection();
    if (!sel || sel.kind !== 'rule') return null;
    const rule = (this.report()?.rules ?? []).find((r) => r.ruleId === sel.id);
    if (!rule) return null;
    const findings = this.findings().filter((f) => f.requirementId === sel.id);
    return { rule, findings };
  });

  constructor() {
    effect(() => {
      if (this.sessionId()) this.load();
    });
  }

  load(): void {
    const id = this.sessionId();
    if (!id) return;
    this.loading.set(true);
    this.selected.set(null);
    this.requirementService.getReport(id).subscribe({
      next: (report) => { this.report.set(report); this.loading.set(false); },
      error: () => { this.report.set(null); this.loading.set(false); },
    });
    this.canService.getIntegrityFaults(id).subscribe({
      next: (faults) => this.allFaults.set(faults),
      error: () => this.allFaults.set([]),
    });
    this.canService.getFindingClusters(id).subscribe({
      next: (clusters) => this.clusters.set(clusters),
      error: () => this.clusters.set([]),
    });
  }

  selectCheck(type: string): void {
    this.selected.set({ kind: 'check', type });
  }

  selectRule(id: string): void {
    this.selected.set({ kind: 'rule', id });
  }

  isCheckSelected(type: string): boolean {
    const sel = this.effectiveSelection();
    return sel?.kind === 'check' && sel.type === type;
  }

  isRuleSelected(id: string): boolean {
    const sel = this.effectiveSelection();
    return sel?.kind === 'rule' && sel.id === id;
  }

  /** ML findings the correlator attached to this requirement finding (Phase 5). */
  supportingMl(f: IntegrityFault): SupportingMlRef[] {
    return f.correlation?.supportingMl ?? [];
  }

  /**
   * Cross-view correlation (§3.2): publish this finding's window + involved
   * signals; the inspector switches to Charts and the charts zoom to it.
   */
  viewInCharts(f: IntegrityFault, event: Event): void {
    event.stopPropagation();
    const ev = f.evidence as Record<string, unknown> | null | undefined;
    const raw = ev?.['triggerTs'] ?? ev?.['enteredTs'];
    const start = typeof raw === 'number' ? raw : (f.frameTimestamp ?? 0);
    const end = Math.max(f.frameTimestamp ?? start, f.lastSeenTs ?? 0, start);
    const signals = Array.isArray(ev?.['signals'])
      ? (ev!['signals'] as unknown[]).map(String) : [];
    this.findingFocus.set({
      start, end, signals,
      label: f.requirementId ?? f.faultType,
      sessionId: this.sessionId(),
    });
  }

  toggleFinding(id: number): void {
    this.expandedFindings.update((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  typeLabel(faultType: string): string {
    switch (faultType) {
      case 'REQUIREMENT_VIOLATED': return 'VIOLATED';
      case 'REQUIREMENT_TIMING_VIOLATED': return 'TIMING';
      case 'ILLEGAL_TRANSITION': return 'ILLEGAL TRANSITION';
      default: return faultType;
    }
  }

  evidenceEntries(fault: IntegrityFault): [string, string][] {
    const evidence = fault.evidence;
    if (!evidence || typeof evidence !== 'object') return [];
    return Object.entries(evidence as Record<string, unknown>).map(
      ([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]
    );
  }

  formatTs(ts: number | null | undefined): string {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleTimeString();
  }
}
