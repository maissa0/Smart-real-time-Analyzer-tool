import {
  ChangeDetectionStrategy, Component, OnInit,
  computed, inject, signal,
} from '@angular/core';
import {
  SessionCompareService,
  SessionCompareResult,
  SessionOption,
  SignalDiff,
} from '../../core/services/session-compare.service';

@Component({
  selector: 'app-session-compare-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="cp-page">
      <div class="cp-header">
        <h1>Session Comparison</h1>
        <p class="cp-sub">AI-powered diff between two CAN recording sessions</p>
      </div>

      <div class="cp-selectors">
        <div class="cp-sel-block">
          <label>Session A</label>
          <select (change)="selectA($event)">
            <option value="">— select session —</option>
            @for (s of sessions(); track s.sessionId) {
              <option [value]="s.sessionId" [selected]="selectedA() === s.sessionId">
                {{ s.sourceFilename }} · {{ s.sessionId.slice(0, 8) }} · {{ s.status }}
              </option>
            }
          </select>
        </div>

        <button class="cp-swap" (click)="swap()" title="Swap A and B">⇄</button>

        <div class="cp-sel-block">
          <label>Session B</label>
          <select (change)="selectB($event)">
            <option value="">— select session —</option>
            @for (s of sessions(); track s.sessionId) {
              <option [value]="s.sessionId" [selected]="selectedB() === s.sessionId">
                {{ s.sourceFilename }} · {{ s.sessionId.slice(0, 8) }} · {{ s.status }}
              </option>
            }
          </select>
        </div>

        <button class="cp-run" [disabled]="!canCompare() || loading()" (click)="runCompare()">
          @if (loading()) { Analysing… } @else { Compare → }
        </button>
      </div>

      @if (error()) {
        <div class="cp-error">{{ error() }}</div>
      }

      @if (loading()) {
        <div class="cp-loading">
          <div class="cp-spinner"></div>
          <p>Fetching signal statistics and generating AI analysis…</p>
        </div>
      }

      @if (result(); as r) {
        <div class="cp-meta-row">
          <div class="cp-meta side-a">
            <div class="cp-meta-lbl">Session A</div>
            <div class="cp-meta-file">{{ r.filenameA }}</div>
            <div class="cp-meta-vehicle">{{ r.vehicleA }}</div>
          </div>
          <div class="cp-vs">vs</div>
          <div class="cp-meta side-b">
            <div class="cp-meta-lbl">Session B</div>
            <div class="cp-meta-file">{{ r.filenameB }}</div>
            <div class="cp-meta-vehicle">{{ r.vehicleB }}</div>
          </div>
        </div>

        <div class="cp-badges">
          <span class="badge b-stable">{{ stableCount() }} Stable</span>
          <span class="badge b-shifted">{{ shiftedCount() }} Shifted</span>
          <span class="badge b-volatile">{{ volatileCount() }} Volatile</span>
          <span class="badge b-both">{{ bothCount() }} Both Changed</span>
          @if (r.onlyInA.length) {
            <span class="badge b-missing">{{ r.onlyInA.length }} Only in A</span>
          }
          @if (r.onlyInB.length) {
            <span class="badge b-new">{{ r.onlyInB.length }} New in B</span>
          }
        </div>

        @if (differentVehicles()) {
          <div class="cp-vehicle-note">
            These sessions belong to different vehicles ({{ r.vehicleA }} vs {{ r.vehicleB }}) —
            signal and requirement differences largely reflect the different setup, not a
            regression of one car.
          </div>
        }

        <div class="cp-analysis">
          <div class="cp-analysis-hdr">
            <span>AI Analysis</span>
            <span class="cp-model">{{ r.modelUsed }}</span>
          </div>
          <div class="cp-analysis-body">{{ r.analysis }}</div>
        </div>

        @if (r.ruleDiffs?.length) {
          <div class="cp-rules-panel">
            <div class="cp-analysis-hdr">
              <span>Requirement Outcomes — A vs B</span>
              <span class="cp-model">{{ changedRuleCount() }} changed</span>
            </div>
            <table class="cp-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Session A</th>
                  <th>Session B</th>
                </tr>
              </thead>
              <tbody>
                @for (rd of r.ruleDiffs; track rd.ruleId) {
                  <tr [class.rule-changed]="rd.changed">
                    <td class="col-name">{{ rd.ruleId }}</td>
                    <td>{{ rd.title }}</td>
                    <td>{{ rd.severity }}</td>
                    <td [class]="outcomeClass(rd.outcomeA)">{{ rd.outcomeA.replace('_', ' ') }}</td>
                    <td [class]="outcomeClass(rd.outcomeB)">{{ rd.outcomeB.replace('_', ' ') }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <div class="cp-signal-panel">
          <div class="cp-filters">
            <button class="fbtn" [class.active]="filter() === 'all'" (click)="filter.set('all')">
              All ({{ r.diffs.length }})
            </button>
            <button class="fbtn" [class.active]="filter() === 'SHIFTED'" (click)="filter.set('SHIFTED')">
              Shifted ({{ shiftedCount() }})
            </button>
            <button class="fbtn" [class.active]="filter() === 'VOLATILE'" (click)="filter.set('VOLATILE')">
              Volatile ({{ volatileCount() }})
            </button>
            <button class="fbtn" [class.active]="filter() === 'BOTH_CHANGED'" (click)="filter.set('BOTH_CHANGED')">
              Both Changed ({{ bothCount() }})
            </button>
            <button class="fbtn" [class.active]="filter() === 'STABLE'" (click)="filter.set('STABLE')">
              Stable ({{ stableCount() }})
            </button>
            @if (r.onlyInA.length || r.onlyInB.length) {
              <button class="fbtn" [class.active]="filter() === 'exclusive'" (click)="filter.set('exclusive')">
                New / Missing
              </button>
            }
          </div>

          @if (filter() !== 'exclusive') {
            <table class="cp-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>A &nbsp;mean ± σ</th>
                  <th>B &nbsp;mean ± σ</th>
                  <th>Mean Δ%</th>
                  <th>σ Ratio</th>
                  <th>Diverged</th>
                  <th>Tag</th>
                </tr>
              </thead>
              <tbody>
                @if (filteredDiffs().length === 0) {
                  <tr>
                    <td colspan="7" class="cp-empty-row">
                      @if (r.diffs.length === 0) {
                        No signals are common to both sessions — see the Exclusive tab
                        for what each session has that the other lacks.
                      } @else {
                        No common signals match this filter.
                      }
                    </td>
                  </tr>
                }
                @for (d of filteredDiffs(); track d.signalName) {
                  <tr [class]="rowClass(d.changeTag)">
                    <td class="col-name">{{ d.signalName }}</td>
                    <td class="col-stat">{{ fmt(d.meanA) }} ± {{ fmt(d.stddevA) }}</td>
                    <td class="col-stat">{{ fmt(d.meanB) }} ± {{ fmt(d.stddevB) }}</td>
                    <td class="col-delta" [class.pos]="d.meanDeltaPct > 0" [class.neg]="d.meanDeltaPct < 0">
                      {{ fmtDelta(d) }}
                    </td>
                    <td class="col-ratio">{{ fmtRatio(d.stddevRatio) }}</td>
                    <td class="col-diverged" [title]="d.divergedAtSec != null ? 'A and B first differ ' + fmt(d.divergedAtSec, 1) + 's after session start' : 'No material divergence found'">
                      {{ d.divergedAtSec != null ? '+' + fmt(d.divergedAtSec, 1) + 's' : '—' }}
                    </td>
                    <td><span [class]="tagClass(d.changeTag)">{{ tagLabel(d.changeTag) }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <div class="cp-exclusive">
              @if (r.onlyInA.length) {
                <div class="excl-group">
                  <div class="excl-lbl">Only in Session A (missing from B)</div>
                  <div class="excl-chips">
                    @for (s of r.onlyInA; track s) {
                      <span class="chip chip-a">{{ s }}</span>
                    }
                  </div>
                </div>
              }
              @if (r.onlyInB.length) {
                <div class="excl-group">
                  <div class="excl-lbl">Only in Session B (new signals)</div>
                  <div class="excl-chips">
                    @for (s of r.onlyInB; track s) {
                      <span class="chip chip-b">{{ s }}</span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .cp-page { padding: 1.5rem; max-width: 1400px; margin: 0 auto; color: #e0e0e0; }
    .cp-header h1 { color: #b0ff44; font-size: 1.4rem; font-weight: 700; margin: 0 0 0.2rem; }
    .cp-sub { color: #888; font-size: 0.85rem; margin: 0 0 1.5rem; }

    .cp-selectors { display: flex; align-items: flex-end; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .cp-sel-block { flex: 1; min-width: 200px; }
    .cp-sel-block label { display: block; font-size: 0.72rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; }
    .cp-sel-block select { width: 100%; background: #1a1a1a; color: #e0e0e0; border: 1px solid #333; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.85rem; }
    .cp-sel-block select:focus { outline: none; border-color: #b0ff44; }
    .cp-swap { background: #1a1a1a; border: 1px solid #333; color: #b0ff44; border-radius: 6px; padding: 0.5rem 0.9rem; font-size: 1.2rem; cursor: pointer; }
    .cp-swap:hover { background: #252525; }
    .cp-run { padding: 0.5rem 1.5rem; background: #b0ff44; color: #111; border: none; border-radius: 6px; font-weight: 700; font-size: 0.9rem; cursor: pointer; white-space: nowrap; }
    .cp-run:disabled { opacity: 0.4; cursor: not-allowed; }
    .cp-run:not(:disabled):hover { opacity: 0.85; }

    .cp-error { background: rgba(255,80,80,0.1); border: 1px solid rgba(255,80,80,0.3); color: #ff6b6b; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.85rem; }
    .cp-loading { text-align: center; padding: 3rem; color: #888; }
    .cp-spinner { width: 32px; height: 32px; border: 3px solid #333; border-top-color: #b0ff44; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .cp-meta-row { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; }
    .cp-meta { flex: 1; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 0.75rem 1rem; }
    .side-a { border-left: 3px solid #4a9eff; }
    .side-b { border-left: 3px solid #b0ff44; }
    .cp-meta-lbl { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 0.2rem; }
    .cp-meta-file { font-size: 0.9rem; font-weight: 600; color: #e0e0e0; word-break: break-all; }
    .cp-meta-vehicle { font-size: 0.8rem; color: #888; }
    .cp-vs { color: #555; font-size: 1.2rem; padding: 0 0.25rem; }

    .cp-badges { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .badge { padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
    .b-stable  { background: rgba(150,150,150,0.15); color: #aaa; }
    .b-shifted { background: rgba(255,180,0,0.15);   color: #ffb400; }
    .b-volatile{ background: rgba(255,80,80,0.15);   color: #ff6b6b; }
    .b-both    { background: rgba(255,50,50,0.2);    color: #ff4444; }
    .b-missing { background: rgba(100,130,255,0.15); color: #8899ff; }
    .b-new     { background: rgba(176,255,68,0.15);  color: #b0ff44; }

    .cp-empty-row { text-align: center; color: #888; padding: 1.25rem; font-size: 0.85rem; }
    .cp-vehicle-note {
      background: rgba(232, 167, 44, 0.08); border: 1px solid rgba(232, 167, 44, 0.35);
      color: #e8a72c; border-radius: 8px; padding: 0.8rem 1rem; margin-bottom: 1.5rem;
      font-size: 0.85rem; line-height: 1.5;
    }
    .cp-rules-panel { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
    .rule-changed { background: rgba(255, 180, 0, 0.07); }
    .oc-pass { color: #57d06a; font-weight: 600; }
    .oc-fail { color: #ff6b6b; font-weight: 700; }
    .oc-timing { color: #e8a72c; font-weight: 600; }
    .oc-muted { color: #777; }

    .cp-analysis { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
    .cp-analysis-hdr { display: flex; justify-content: space-between; font-weight: 700; color: #e0e0e0; margin-bottom: 0.75rem; }
    .cp-model { font-size: 0.7rem; color: #666; font-weight: 400; }
    .cp-analysis-body { color: #b0b0b0; line-height: 1.8; white-space: pre-line; font-size: 0.88rem; }

    .cp-signal-panel { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; overflow: hidden; }
    .cp-filters { display: flex; gap: 0.4rem; padding: 0.75rem 1rem; border-bottom: 1px solid #2a2a2a; flex-wrap: wrap; }
    .fbtn { background: none; border: 1px solid #333; color: #888; border-radius: 4px; padding: 0.3rem 0.65rem; font-size: 0.75rem; cursor: pointer; }
    .fbtn:hover { border-color: #555; color: #ccc; }
    .fbtn.active { background: #b0ff44; color: #111; border-color: #b0ff44; font-weight: 700; }

    .cp-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .cp-table th { background: #111; color: #777; text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.68rem; padding: 0.6rem 1rem; text-align: left; border-bottom: 1px solid #222; }
    .cp-table td { padding: 0.45rem 1rem; border-bottom: 1px solid #1e1e1e; }
    .cp-table tr:hover td { background: rgba(176,255,68,0.02); }
    .col-name  { font-family: monospace; color: #e0e0e0; font-weight: 600; }
    .col-stat  { font-family: monospace; color: #999; }
    .col-delta { font-weight: 700; }
    .col-delta.pos { color: #ff6b6b; }
    .col-delta.neg { color: #4a9eff; }
    .col-ratio { font-family: monospace; color: #999; }
    .row-shifted td     { background: rgba(255,180,0,0.02); }
    .row-volatile td    { background: rgba(255,80,80,0.02); }
    .row-both-changed td{ background: rgba(255,50,50,0.04); }

    .tag { padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.68rem; font-weight: 700; }
    .tag-stable       { background: rgba(150,150,150,0.2); color: #aaa; }
    .tag-shifted      { background: rgba(255,180,0,0.2);   color: #ffb400; }
    .tag-volatile     { background: rgba(255,80,80,0.2);   color: #ff6b6b; }
    .tag-both-changed { background: rgba(255,50,50,0.25);  color: #ff4444; }

    .cp-exclusive { padding: 1.5rem; }
    .excl-group { margin-bottom: 1.5rem; }
    .excl-lbl { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .excl-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .chip { padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-family: monospace; }
    .chip-a { background: rgba(100,130,255,0.15); color: #8899ff; }
    .chip-b { background: rgba(176,255,68,0.15);  color: #b0ff44; }
  `],
})
export class SessionComparePageComponent implements OnInit {
  private readonly svc = inject(SessionCompareService);

  readonly sessions  = signal<SessionOption[]>([]);
  readonly selectedA = signal('');
  readonly selectedB = signal('');
  readonly loading   = signal(false);
  readonly result    = signal<SessionCompareResult | null>(null);
  readonly error     = signal('');
  readonly filter    = signal('all');

  readonly canCompare = computed(() =>
    !!this.selectedA() && !!this.selectedB() && this.selectedA() !== this.selectedB()
  );

  readonly filteredDiffs = computed(() => {
    const r = this.result();
    if (!r) return [];
    const f = this.filter();
    return f === 'all' ? r.diffs : r.diffs.filter(d => d.changeTag === f);
  });

  readonly stableCount   = computed(() => this.result()?.diffs.filter(d => d.changeTag === 'STABLE').length ?? 0);
  readonly shiftedCount  = computed(() => this.result()?.diffs.filter(d => d.changeTag === 'SHIFTED').length ?? 0);
  readonly volatileCount = computed(() => this.result()?.diffs.filter(d => d.changeTag === 'VOLATILE').length ?? 0);
  readonly bothCount     = computed(() => this.result()?.diffs.filter(d => d.changeTag === 'BOTH_CHANGED').length ?? 0);

  ngOnInit(): void {
    this.svc.getSessions().subscribe({
      next: s => this.sessions.set(s),
      error: () => this.error.set('Failed to load sessions list.'),
    });
  }

  selectA(e: Event): void { this.selectedA.set((e.target as HTMLSelectElement).value); }
  selectB(e: Event): void { this.selectedB.set((e.target as HTMLSelectElement).value); }

  swap(): void {
    const tmp = this.selectedA();
    this.selectedA.set(this.selectedB());
    this.selectedB.set(tmp);
  }

  runCompare(): void {
    if (!this.canCompare()) return;
    this.loading.set(true);
    this.error.set('');
    this.result.set(null);
    this.filter.set('all');
    this.svc.compare(this.selectedA(), this.selectedB()).subscribe({
      next: r  => {
        this.result.set(r);
        this.loading.set(false);
        // Nothing in common → the diff table would be blank; open the
        // exclusive lists directly so the result is never an empty screen.
        this.filter.set(
          r.diffs.length === 0 && (r.onlyInA.length || r.onlyInB.length)
            ? 'exclusive' : 'all');
      },
      error: err => {
        this.error.set(err?.error?.message ?? 'Comparison failed. Ensure both sessions have signal data.');
        this.loading.set(false);
      },
    });
  }

  rowClass(tag: string): string { return 'row-' + tag.toLowerCase().replace(/_/g, '-'); }
  tagClass(tag: string): string { return 'tag tag-' + tag.toLowerCase().replace(/_/g, '-'); }

  changedRuleCount(): number {
    return this.result()?.ruleDiffs?.filter(r => r.changed).length ?? 0;
  }

  /** True when the two sessions belong to different vehicles/configurations. */
  differentVehicles(): boolean {
    const r = this.result();
    return !!r && r.vehicleA !== r.vehicleB;
  }

  /** "+100% from zero" is a sentinel — say what actually happened instead. */
  fmtDelta(d: SignalDiff): string {
    if (Math.abs(d.meanA) < 0.001 && Math.abs(d.meanB) >= 0.001) return 'became active';
    if (Math.abs(d.meanB) < 0.001 && Math.abs(d.meanA) >= 0.001) return 'went silent';
    return (d.meanDeltaPct > 0 ? '+' : '') + this.fmt(d.meanDeltaPct, 1) + '%';
  }

  /** 999× is the "was flat, now varies" sentinel; 0× the reverse. */
  fmtRatio(ratio: number): string {
    if (ratio >= 999) return 'flat → varies';
    if (ratio <= 0.001) return 'varies → flat';
    return this.fmt(ratio) + '×';
  }

  outcomeClass(outcome: string): string {
    switch (outcome) {
      case 'PASS': return 'oc-pass';
      case 'VIOLATED': return 'oc-fail';
      case 'TIMING_VIOLATED': return 'oc-timing';
      default: return 'oc-muted';
    }
  }
  tagLabel(tag: string): string { return tag.replace(/_/g, ' '); }
  fmt(n: number, dec = 2): string { return n.toFixed(dec); }
}