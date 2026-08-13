import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CanService } from '../../../core/services/can.service';
import { CanSession } from '../../../core/models/can.model';
import { API_BASE_URL } from '../../../core/config/api.config';
import { SimulatorStateService } from '../../sniffer/simulator/simulator-state.service';
import { SnifferComponent } from '../../sniffer/sniffer.component';
import { ReportTabComponent } from './report-tab/report-tab.component';
import { TwinTabComponent } from './twin-tab/twin-tab.component';
import { RequirementsTabComponent } from './requirements-tab/requirements-tab.component';
import { FindingFocusService } from '../../../core/services/finding-focus.service';
import { NlQueryService, NlQueryResponse } from '../../../core/services/nl-query.service';

type InspectorTab = 'table' | 'charts' | 'requirements' | 'report' | 'twin';

@Component({
  selector: 'app-session-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, SnifferComponent, ReportTabComponent, TwinTabComponent,
    RequirementsTabComponent],
  styles: [`
    :host {
      display: flex; flex-direction: column; background: #07090b; overflow: hidden;
      /* admin-layout's .kpit-main-content only sets min-height (so other admin
         pages can page-scroll), which means height:100% never resolves here.
         Size directly off the viewport instead — self-contained, doesn't touch
         the shared layout. Cancel only the bottom p-6 padding (24px); the top
         52px is real navbar clearance and must stay. */
      height: calc(100vh - 52px);
      margin-bottom: -24px;
    }

    .breadcrumb {
      display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 1.25rem;
      background: #0d1117; border-bottom: 1px solid rgba(176,255,68,0.08);
      flex-shrink: 0; font-size: 0.75rem;
    }
    .breadcrumb-back {
      display: flex; align-items: center; gap: 0.3rem; color: #b0ff44;
      cursor: pointer; background: none; border: none; font-size: 0.75rem;
      padding: 0; transition: opacity 0.15s;
    }
    .breadcrumb-back:hover { opacity: 0.75; }
    .breadcrumb-sep { color: #484f58; }
    .breadcrumb-current { color: #8a9ab0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
    .status-badge {
      padding: 2px 7px; border-radius: 4px; font-size: 0.62rem; font-weight: 700;
      letter-spacing: 0.05em;
    }
    .status-live { background: rgba(176,255,68,0.15); color: #b0ff44; }
    .status-complete { background: rgba(63,185,80,0.15); color: #3fb950; }
    .status-error { background: rgba(255,68,68,0.15); color: #ff4444; }
    .status-other { background: rgba(72,79,88,0.2); color: #8a9ab0; }

    .breadcrumb-actions { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
    .btn-replay {
      display: flex; align-items: center; gap: 0.35rem;
      padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 600;
      border: 1px solid rgba(176,255,68,0.25); background: transparent; color: #b0ff44;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-replay:hover { background: rgba(176,255,68,0.08); }
    .btn-stop-sim {
      display: flex; align-items: center; gap: 0.35rem;
      padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 600;
      border: 1px solid rgba(255,68,68,0.35); background: transparent; color: #ff4444;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-stop-sim:hover { background: rgba(255,68,68,0.08); }

    .meta-bar {
      display: flex; align-items: center; gap: 1.5rem; padding: 0.55rem 1.25rem;
      background: #0d1117; border-bottom: 1px solid rgba(176,255,68,0.06);
      flex-shrink: 0; flex-wrap: wrap;
    }
    .meta-item { font-size: 0.7rem; color: #8a9ab0; white-space: nowrap; }
    .meta-item strong { color: #e6edf3; font-weight: 600; }
    .meta-divider { width: 1px; height: 14px; background: #21262d; }

    .tab-bar {
      display: flex; align-items: center;
      background: #0d1117; border-bottom: 1px solid rgba(176,255,68,0.08);
      flex-shrink: 0; padding: 0 1.25rem;
    }
    .tab-btn {
      padding: 0.6rem 1.1rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase; cursor: pointer; background: none; border: none;
      color: #484f58; border-bottom: 2px solid transparent; transition: all 0.15s;
      margin-bottom: -1px;
    }
    .tab-btn:hover { color: #8a9ab0; }
    .tab-btn.active { color: #b0ff44; border-bottom-color: #b0ff44; }

    .filter-bar {
      display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 1.25rem;
      background: #07090b; border-bottom: 1px solid rgba(176,255,68,0.06);
      flex-shrink: 0; flex-wrap: wrap;
    }
    .filter-select {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      color: #e6edf3; font-size: 0.75rem; padding: 4px 8px; outline: none; cursor: pointer;
    }
    .filter-select:focus { border-color: rgba(176,255,68,0.4); }
    .filter-toggle {
      padding: 4px 10px; border-radius: 6px; font-size: 0.72rem; font-weight: 600;
      border: 1px solid #30363d; background: transparent; color: #8a9ab0; cursor: pointer;
      transition: all 0.15s;
    }
    .filter-toggle:hover { border-color: rgba(176,255,68,0.3); color: #b0ff44; }
    .filter-toggle.active { border-color: rgba(176,255,68,0.5); color: #b0ff44; background: rgba(176,255,68,0.08); }
    .filter-divider { width: 1px; height: 18px; background: #21262d; }
    .filter-ai-input {
      flex: 1; min-width: 180px; background: #161b22; border: 1px solid #30363d;
      border-radius: 6px; color: #e6edf3; font-size: 0.75rem; padding: 4px 10px; outline: none;
    }
    .filter-ai-input::placeholder { color: #484f58; }
    .filter-ai-input:focus { border-color: rgba(176,255,68,0.3); }
    .btn-ask {
      padding: 4px 12px; border-radius: 6px; font-size: 0.72rem; font-weight: 600;
      background: rgba(176,255,68,0.12); border: 1px solid rgba(176,255,68,0.25);
      color: #b0ff44; cursor: pointer; transition: all 0.15s; white-space: nowrap;
    }
    .btn-ask:hover { background: rgba(176,255,68,0.2); }
    .clear-filters {
      padding: 4px 8px; border-radius: 6px; font-size: 0.68rem; color: #484f58;
      background: none; border: none; cursor: pointer; transition: color 0.15s;
    }
    .clear-filters:hover { color: #ff6b6b; }

    .tab-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    /* Whichever tab is mounted (app-sniffer/app-report-tab/app-twin-tab) must be
       forced to fill this space — app-sniffer has no :host sizing of its own, so
       without this it hugs its content height and gets clipped by the overflow:
       hidden above instead of scrolling internally. */
    .tab-content > * { flex: 1; min-height: 0; }

    .ai-results-panel {
      flex-shrink: 0; max-height: 260px; overflow-y: auto;
      background: #0d1117; border-bottom: 1px solid rgba(176,255,68,0.1);
      padding: 0.75rem 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;
    }
    .ai-results-header {
      display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    }
    .ai-explanation { font-size: 0.75rem; color: #b0ff44; flex: 1; }
    .ai-meta { font-size: 0.65rem; color: #484f58; white-space: nowrap; }
    .ai-close {
      background: none; border: none; color: #484f58; cursor: pointer;
      font-size: 0.75rem; padding: 0 4px; line-height: 1;
    }
    .ai-close:hover { color: #ff6b6b; }
    .ai-error { font-size: 0.75rem; color: #ff6b6b; }
    .ai-table-wrap { overflow-x: auto; }
    .ai-table {
      width: 100%; border-collapse: collapse; font-size: 0.68rem; font-family: monospace;
    }
    .ai-table th {
      text-align: left; padding: 3px 8px; color: #8a9ab0; font-weight: 600;
      border-bottom: 1px solid #21262d; white-space: nowrap;
    }
    .ai-table td {
      padding: 3px 8px; color: #e6edf3; border-bottom: 1px solid #161b22;
      max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ai-table tr:hover td { background: rgba(176,255,68,0.04); }
    .ai-no-results { font-size: 0.72rem; color: #484f58; font-style: italic; }

    .spinner {
      width: 18px; height: 18px; border: 2px solid #21262d; border-top-color: #b0ff44;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-state {
      display: flex; align-items: center; justify-content: center; height: 100%;
      color: #8a9ab0; font-size: 0.82rem; gap: 0.75rem;
    }
  `],
  template: `
    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <button class="breadcrumb-back" (click)="goBack()">← Sessions</button>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">{{ displayName() }}</span>
      @if (session()?.status; as st) {
        <span class="status-badge" [class]="statusBadgeClass(st)">{{ st }}</span>
      }
      <div class="breadcrumb-actions">
        @if (showStopBtn()) {
          <button class="btn-stop-sim" (click)="stopSimulator()">■ Stop Simulator</button>
        }
        @if (session()?.status === 'COMPLETE') {
          <button class="btn-replay" (click)="goReplay()">Replay View →</button>
        }
      </div>
    </div>

    <!-- Metadata bar (hidden on the 3D Twin tab to maximize vertical stage space) -->
    @if (activeTab() !== 'twin') {
      <div class="meta-bar">
        @if (session(); as s) {
          <span class="meta-item"><strong>{{ s.frameCount | number }}</strong> frames</span>
          <div class="meta-divider"></div>
          @if (duration(); as d) {
            <span class="meta-item">Duration <strong>{{ d }}</strong></span>
            <div class="meta-divider"></div>
          }
          <span class="meta-item">{{ s.createdAt | date:'d MMM yyyy, HH:mm' }}</span>
        } @else {
          <div class="spinner"></div>
        }
      </div>
    }

    <!-- Tab bar -->
    <div class="tab-bar">
      <button class="tab-btn" [class.active]="activeTab() === 'table'"
              (click)="activeTab.set('table')">Table</button>
      <button class="tab-btn" [class.active]="activeTab() === 'charts'"
              (click)="activeTab.set('charts')">Charts</button>
      <button class="tab-btn" [class.active]="activeTab() === 'requirements'"
              (click)="activeTab.set('requirements')">Checks</button>
      <button class="tab-btn" [class.active]="activeTab() === 'report'"
              (click)="activeTab.set('report')">Report</button>
      <button class="tab-btn" [class.active]="activeTab() === 'twin'"
              (click)="openTwin()">3D Twin</button>
    </div>

    <!-- Filter bar (data tabs only) -->
    @if (activeTab() !== 'report' && activeTab() !== 'twin' && activeTab() !== 'requirements') {
      <div class="filter-bar">
        <select class="filter-select" (change)="onBusChange($event)">
          <option value="">All Buses</option>
          @for (b of availableBuses(); track b) {
            <option [value]="b" [selected]="filterBus() === b">{{ b }}</option>
          }
        </select>

        <select class="filter-select" (change)="onMsgIdChange($event)">
          <option value="">All Msg IDs</option>
          @for (id of availableMsgIds(); track id) {
            <option [value]="id" [selected]="filterMsgId() === id">{{ id }}</option>
          }
        </select>

        <div class="filter-divider"></div>

        <button class="filter-toggle" [class.active]="faultsOnly()"
                (click)="faultsOnly.update(v => !v)">⚠ Faults</button>
        <button class="filter-toggle" [class.active]="anomalyOnly()"
                (click)="anomalyOnly.update(v => !v)">● Anomalies</button>

        <div class="filter-divider"></div>

        <input class="filter-ai-input" type="text"
               placeholder="Ask AI to filter… e.g. EngineSpeed > 4000"
               [value]="aiFilterText()"
               (input)="aiFilterText.set(getValue($event))"
               (keydown.enter)="applyAiFilter()" />
        <button class="btn-ask" [disabled]="aiLoading()" (click)="applyAiFilter()">
          {{ aiLoading() ? '…' : 'Ask' }}
        </button>

        @if (hasActiveFilters()) {
          <button class="clear-filters" (click)="clearFilters()">✕ Clear</button>
        }
      </div>
    }

    <!-- AI results panel -->
    @if (aiError()) {
      <div class="ai-results-panel">
        <div class="ai-results-header">
          <span class="ai-error">⚠ {{ aiError() }}</span>
          <button class="ai-close" (click)="aiError.set(null)">✕</button>
        </div>
      </div>
    }
    @if (aiResults(); as r) {
      <div class="ai-results-panel">
        <div class="ai-results-header">
          <span class="ai-explanation">{{ r.explanation }}</span>
          <span class="ai-meta">{{ r.rowCount }} rows · {{ r.executionMs }}ms</span>
          <button class="ai-close" (click)="aiResults.set(null)">✕</button>
        </div>
        @if (r.results.length === 0) {
          <span class="ai-no-results">No results found.</span>
        } @else {
          <div class="ai-table-wrap">
            <table class="ai-table">
              <thead>
                <tr>
                  @for (col of objectKeys(r.results[0]); track col) {
                    <th>{{ col }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of r.results; track $index) {
                  <tr>
                    @for (col of objectKeys(row); track col) {
                      <td [title]="stringify(row[col])">{{ stringify(row[col]) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }

    <!-- Tab content -->
    <div class="tab-content">
      @if (activeTab() === 'report') {
        <app-report-tab [sessionId]="sessionId()" [session]="session()"
                        (viewTable)="onReportViewTable($event)"
                        (viewTwin)="onReportViewTwin($event)" />
      } @else if (activeTab() === 'requirements' && sessionId()) {
        <app-requirements-tab [sessionId]="sessionId()" />
      } @else if (!sessionId() && activeTab() !== 'twin') {
        <div class="loading-state">
          <div class="spinner"></div>
          Loading session…
        </div>
      }
      <!-- Kept mounted (hidden) like the twin tab below: destroying the sniffer
           on Requirements/Report/Twin re-streams the whole InfluxDB playback
           when the user returns to a data tab (e.g. the finding→charts jump),
           repainting the charts several times. -->
      @if (sessionId()) {
        <app-sniffer
          [style.display]="isDataTab() ? null : 'none'"
          [activeTabOverride]="snifferTab()"
          [autoSelectSessionId]="sessionId()"
          [hideUpload]="true"
          [hideSimulator]="true"
          [externalBusFilter]="filterBus()"
          [externalMsgId]="filterMsgId()"
          [externalFaultsOnly]="faultsOnly()"
          [externalAnomalyOnly]="anomalyOnly()"
          (durationChanged)="snifferDuration.set($event)"
        />
      }
      <!-- Kept mounted (hidden) once opened: destroying it on tab switch would
           re-download the ~100MB Unity build and re-buffer the whole session
           every time the user comes back to the 3D Twin tab. -->
      @if (twinEverOpened()) {
        <app-twin-tab [style.display]="activeTab() === 'twin' ? null : 'none'"
                      [sessionId]="sessionId()" [session]="session()"
                      [seekTo]="twinSeek()" />
      }
    </div>
  `,
})
export class SessionInspectorComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private canService = inject(CanService);
  private http = inject(HttpClient);
  private simulatorState = inject(SimulatorStateService);
  private destroyRef = inject(DestroyRef);

  sessionId = signal('');
  returnUrl = signal('/admin/workspace');
  session = signal<CanSession | null>(null);
  activeTab = signal<InspectorTab>('table');
  /** Latched true on first visit — the twin tab stays mounted (hidden) afterwards. */
  twinEverOpened = signal(false);
  /** Seek request for the twin's replay (token distinguishes repeat seeks to the same t). */
  twinSeek = signal<{ t: number; token: number } | null>(null);
  private twinSeekToken = 0;

  snifferTab = computed<'table' | 'charts' | 'integrity'>(() => {
    const t = this.activeTab();
    return t === 'charts' ? 'charts' : 'table';
  });

  /** Tabs rendered by the embedded sniffer — it stays mounted (hidden) on the others.
   *  Integrity now lives inside the merged Checks tab (requirements-tab). */
  readonly isDataTab = computed(() => {
    const t = this.activeTab();
    return t === 'table' || t === 'charts';
  });

  filterBus = signal('');
  filterMsgId = signal('');
  faultsOnly = signal(false);
  anomalyOnly = signal(false);
  aiFilterText = signal('');
  aiLoading = signal(false);
  aiResults = signal<NlQueryResponse | null>(null);
  aiError = signal<string | null>(null);

  private readonly nlQueryService = inject(NlQueryService);
  private readonly findingFocus = inject(FindingFocusService);

  /** A finding was clicked "View in charts" — bring the Charts tab forward. */
  private readonly findingFocusEffect = effect(() => {
    if (this.findingFocus.focus()) this.activeTab.set('charts');
  });

  availableBuses = signal<string[]>([]);
  availableMsgIds = signal<string[]>([]);

  isLive = computed(() => {
    const st = this.session()?.status;
    return !st || st.toUpperCase() === 'LIVE';
  });

  showStopBtn = computed(() => this.isLive() && this.simulatorState.isRunning());

  hasActiveFilters = computed(
    () => !!this.filterBus() || !!this.filterMsgId() || this.faultsOnly() || this.anomalyOnly()
  );

  displayName = computed(() => {
    const s = this.session();
    return s?.sourceFilename || this.sessionId();
  });

  snifferDuration = signal<string | null>(null);

  duration = computed(() => {
    const sd = this.snifferDuration();
    if (sd) {
      const sec = parseFloat(sd);
      if (sec > 0) return sec < 60 ? `${sec.toFixed(2)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
    }
    const s = this.session();
    if (!s?.startTs || !s?.endTs) return null;
    const sec = Math.round(s.endTs - s.startTs);
    if (sec <= 0) return null;
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  });

  ngOnInit(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl) this.returnUrl.set(returnUrl);

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('sessionId') ?? '';
        this.sessionId.set(id);
        if (id) this.loadSession(id);
      });
  }

  private loadSession(id: string): void {
    this.canService
      .getSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sessions) => {
        this.session.set(sessions.find((s) => s.sessionId === id) ?? null);
      });

    this.canService
      .getSessionMetadata(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((meta) => {
        this.availableBuses.set(meta.buses ?? []);
        this.availableMsgIds.set(meta.msgIds ?? []);
      });
  }

  onBusChange(event: Event): void {
    const bus = (event.target as HTMLSelectElement).value;
    this.filterBus.set(bus);
    this.filterMsgId.set('');
    this.canService
      .getSessionMetadata(this.sessionId(), bus || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((meta) => this.availableMsgIds.set(meta.msgIds ?? []));
  }

  onMsgIdChange(event: Event): void {
    this.filterMsgId.set((event.target as HTMLSelectElement).value);
  }

  openTwin(): void {
    this.twinEverOpened.set(true);
    this.activeTab.set('twin');
  }

  /** Report-tab evidence link "Table": frame table filtered to the fault's message. */
  onReportViewTable(e: { msgId: string }): void {
    this.filterMsgId.set(e.msgId);
    this.faultsOnly.set(true);
    this.activeTab.set('table');
  }

  /** Report-tab evidence link "Twin @ t": open the twin and seek its replay. */
  onReportViewTwin(e: { t: number }): void {
    this.twinSeek.set({ t: e.t, token: ++this.twinSeekToken });
    this.openTwin();
  }

  applyAiFilter(): void {
    const text = this.aiFilterText().trim();
    if (!text) return;
    const id = this.sessionId();
    const question = id ? `For session ${id}: ${text}` : text;
    this.aiLoading.set(true);
    this.aiResults.set(null);
    this.aiError.set(null);
    this.nlQueryService.query(question)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.aiResults.set(res); this.aiLoading.set(false); },
        error: (err) => {
          this.aiError.set(err?.error?.error ?? 'Query failed. Try rephrasing.');
          this.aiLoading.set(false);
        },
      });
  }

  clearFilters(): void {
    this.filterBus.set('');
    this.filterMsgId.set('');
    this.faultsOnly.set(false);
    this.anomalyOnly.set(false);
    this.aiFilterText.set('');
    const id = this.sessionId();
    if (id) {
      this.canService
        .getSessionMetadata(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((meta) => {
          this.availableBuses.set(meta.buses ?? []);
          this.availableMsgIds.set(meta.msgIds ?? []);
        });
    }
  }

  statusBadgeClass(status: string): string {
    if (status === 'LIVE') return 'status-badge status-live';
    if (status === 'COMPLETE') return 'status-badge status-complete';
    if (status === 'ERROR') return 'status-badge status-error';
    return 'status-badge status-other';
  }

  objectKeys(obj: Record<string, unknown>): string[] { return Object.keys(obj); }
  stringify(v: unknown): string { return v == null ? '' : String(v); }

  getValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  stopSimulator(): void {
    const simId = this.simulatorState.simId();
    if (!simId) return;
    this.http.post(`${API_BASE_URL}/api/simulator/stop/${simId}`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.simulatorState.setStopped();
          const id = this.sessionId();
          if (id) this.loadSession(id);
        },
      });
  }

  goBack(): void {
    this.router.navigateByUrl(this.returnUrl());
  }

  goReplay(): void {
    this.router.navigate(['/admin/workspace/session', this.sessionId(), 'replay'], {
      queryParams: { returnUrl: this.returnUrl() },
    });
  }
}
