import {
  Component,
  OnInit,
  OnDestroy,
  OnChanges,
  ChangeDetectionStrategy,
  HostListener,
  inject,
  signal,
  computed,
  effect,
  DestroyRef,
  ViewChildren,
  QueryList,
  Input,
  Output,
  EventEmitter,
  SimpleChanges,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_BASE_URL } from '../../core/config/api.config';
import { CanService } from '../../core/services/can.service';
import { ToastService } from '../../core/services/toast.service';
import { TelemetryService } from '../../core/services/telemetry.service';
import { LiveTelemetryService } from '../../core/services/live-telemetry.service';
import { CanSession, CanFrame, parseSignals, IntegrityFault, IntegritySummary } from '../../core/models/can.model';
import {
  SignalChartComponent,
  ChartDataset,
  FindingMarker,
} from './signal-chart/signal-chart.component';
import { FindingFocusService } from '../../core/services/finding-focus.service';
import { FrameTableComponent } from './frame-table/frame-table.component';
import { ReplayBarComponent } from './replay-bar/replay-bar.component';
import { LivePipelineComponent } from './live-pipeline/live-pipeline.component';
import { ReplayEngineService } from '../../core/services/replay-engine.service';
import { SessionStateService } from '../../core/services/session-state.service';
import { AuthStore } from '../../core/store/auth.store';
import { FaultDiagnosticEditorComponent } from '../diagnostics/fault-diagnostic-editor.component';

@Component({
  selector: 'app-sniffer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, SignalChartComponent, FrameTableComponent, ReplayBarComponent, LivePipelineComponent, FaultDiagnosticEditorComponent],
  templateUrl: './sniffer.component.html',
})
export class SnifferComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChildren(SignalChartComponent) chartComponents!: QueryList<SignalChartComponent>;

  @Output() durationChanged = new EventEmitter<string>();
  private durationEffect = effect(() => {
    const d = this.durationSeconds();
    if (d !== '0') this.durationChanged.emit(d);
  });

  @Input() hideUpload = false;
  @Input() hideSimulator = false;
  @Input() liveOnly = false;
  @Input() uploadOnly = false;
  @Input() autoSelectLive = false;
  @Input() autoSelectSessionId: string | undefined = undefined;
  /** Live Monitor KPIT styling: lime primary line height, taller canvases — see monitor-page.component.scss */
  @Input() kpitMonitorChartTheme = false;
  @Input() set externalMsgId(val: string) {
    if (this.filterAddress() === val) return;
    this.filterAddress.set(val);
    const session = this.selectedSession();
    if (session) this.loadFrames(session.sessionId);
  }
  @Input() set externalBusFilter(val: string) {
    if (this.filterBus() === val) return;
    this.filterBus.set(val);
    const session = this.selectedSession();
    if (session) this.loadFrames(session.sessionId);
  }
  @Input() set externalFaultsOnly(val: boolean) {
    if (this.faultsOnly() === val) return;
    this.faultsOnly.set(val);
    const session = this.selectedSession();
    if (session) this.loadFrames(session.sessionId);
  }
  @Input() set externalAnomalyOnly(val: boolean) {
    if (this.anomalyOnly() === val) return;
    this.anomalyOnly.set(val);
    const session = this.selectedSession();
    if (session) this.loadFrames(session.sessionId);
  }
  @Input() set externalVisibleMessages(val: Set<string>) {
    this.visibleMessages.set(val);
  }
  @Input() set externalVisibleSignalNames(val: Set<string>) {
    this.visibleSignalNames.set(val);
  }

  private _tabOverride = signal<'table' | 'charts' | 'integrity' | null>(null);

  @Input() set activeTabOverride(tab: 'table' | 'charts' | 'integrity' | null) {
    this._tabOverride.set(tab);
    if (tab) this.setTab(tab);
  }

  /** Mirrors `liveOnly` input so `filteredSessions` stays reactive with signals. */
  private readonly liveOnlyFlag = signal(false);
  private uploadOnlyFlag = signal(false);

  readonly filteredSessions = computed(() => {
    if (this.liveOnlyFlag()) {
      return this.sessions().filter((s) => this.sessionState.isLiveSource(s));
    }
    if (this.uploadOnlyFlag()) {
      return this.sessions().filter((s) => !this.sessionState.isLiveSource(s));
    }
    return this.sessions();
  });

  private canService = inject(CanService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private toastService = inject(ToastService);
  readonly telemetry = inject(TelemetryService);
  readonly liveTelemetry = inject(LiveTelemetryService);
  private readonly sessionState = inject(SessionStateService);
  readonly cars = signal<{ carUid: string; make: string; model: string; year: number; isVirtual: boolean }[]>([]);
  readonly selectedCarUid = signal<string>('');
  private destroyRef = inject(DestroyRef);

  readonly replayEngine = inject(ReplayEngineService);

  private simRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private liveTickInterval: ReturnType<typeof setInterval> | null = null;
  private lastSignalValues = new Map<
    string,
    { value: number; label: string; sessionStartTs: number }
  >();
  private lastRealFrameTime = 0;

  /**
   * Mutable ring buffer for live frames — avoids O(n²) spread on every frame.
   * Capped at MAX_LIVE_FRAMES. The signal allFrames is updated once per RAF
   * cycle, not once per Kafka message.
   */
  private readonly MAX_LIVE_FRAMES = 2000;
  private _frameBuffer: CanFrame[] = [];

  sessions = signal<CanSession[]>([]);
  deletingSessionId = signal<string | null>(null);
  selectedSession = signal<CanSession | null>(null);
  selectedMsgId = signal<string>('');
  loadingSessions = signal(false);
  // Infinite scroll state
  currentPage = signal(0);
  pageSize = 20;
  hasMore = signal(true);
  loadingMore = signal(false);
  loadingFrames = signal(false);
  // Frame pagination state
  readonly framePageSize = 100;
  currentFramePage = signal(0);
  totalFramePages = signal(0);
  hasMoreFrames = signal(false);
  loadingMoreFrames = signal(false);
  activeTab = signal<'table' | 'charts' | 'integrity'>('table');
  chartMode = signal<'stacked' | 'combined'>('stacked');
  chartJsLoaded = signal(false);

  integritySummary = signal<IntegritySummary | null>(null);
  integrityFaults = signal<IntegrityFault[]>([]);
  loadingIntegrity = signal(false);
  integrityFilter = signal<'all' | 'DUPLICATE' | 'TIMING_GAP' | 'SIGNAL_RANGE' | 'COUNTER_ERROR'>('all');
  integritySearch = signal('');

  filteredIntegrityFaults = computed(() => {
    const filter = this.integrityFilter();
    const search = this.integritySearch().trim().toLowerCase();
    return this.integrityFaults().filter((f) => {
      if (filter !== 'all' && f.faultType !== filter) return false;
      if (!search) return true;
      return (
        f.msgId.toLowerCase().includes(search) ||
        f.msgName?.toLowerCase().includes(search) ||
        f.description.toLowerCase().includes(search)
      );
    });
  });

  // All frames for the selected session (from MySQL)
  allFrames = signal<CanFrame[]>([]);

  isLiveSession = signal(false);
  liveFrames = signal<CanFrame[]>([]);

  // InfluxDB server-side playback
  playbackId = signal<string | null>(null);
  playbackActive = signal(false);
  playbackLoading = signal(false); // true while receiving points from server
  playbackComplete = signal(false); // true when all points have been displayed
  playbackPoints: Array<{time: number; signalName: string; value: number; label: string; pid?: string}> = [];
  playbackPointIndex = 0;

  /**
   * Our own server playback id (from the REST start response). The playback
   * topic is shared with the 3D twin's buffering — events from a concurrent
   * foreign playback (especially its early 'complete') must be ignored or
   * whole signals go missing from the charts.
   */
  private ownPlaybackId: string | null = null;

  /** True when the event belongs to a different concurrent playback stream. */
  private isForeignPlayback(pid: string | null | undefined): boolean {
    return !!pid && !!this.ownPlaybackId && pid !== this.ownPlaybackId;
  }

  get playbackProgress(): number {
    if (this.playbackPoints.length === 0) return 0;
    return Math.min(100, Math.round(
      (this.playbackPointIndex / this.playbackPoints.length) * 100
    ));
  }

  private influxPlaybackSub: Subscription | null = null;
  /** Server playback start (matches REST/Influx); avoids client session.startTs float mismatch */
  private playbackSessionStartTs = 0;

  // 60Hz chart update buffer
  private pendingChartPoints: Array<{
    signalName: string;
    point: { x: number; y: number; label: string };
  }> = [];
  private rafId: number | null = null;
  private rafRunning = false;
  private _lastChartUpdate = 0;

  /**
   * Stable chart groups for live mode (refreshed on loadFrames only).
   * Prevents @Input churn on every WebSocket frame; points grow via appendPoint.
   */
  liveChartGroups = signal<Array<{
    groupTitle: string;
    msgName: string;
    datasets: ChartDataset[];
  }> | null>(null);

  liveSignalGroups = computed(() => this.liveChartGroups() ?? []);

  // ⊟ stacked: one chart per individual signal
  readonly stackedSignalGroups = computed(() =>
    (this.liveChartGroups() ?? []).flatMap((group) =>
      group.datasets.map((ds) => ({
        groupTitle: ds.signalName,
        msgName: group.msgName,
        datasets: [ds],
      }))
    )
  );

  // ⊞ combined: one chart per message; ⊟ stacked: one chart per signal.
  // When a signal filter is active (e.g. a finding's "Charts" jump publishes
  // the involved signals), only charts carrying those signals are shown —
  // cleared together with the zoom via clearChartZoom().
  readonly activeChartGroups = computed(() => {
    const groups = this.chartMode() === 'combined'
      ? this.liveSignalGroups() : this.stackedSignalGroups();
    const focus = this.visibleSignalNames();
    if (focus.size === 0) return groups;
    const filtered = groups
      .map((g) => ({ ...g, datasets: g.datasets.filter((ds) => focus.has(ds.signalName)) }))
      .filter((g) => g.datasets.length > 0);
    // Never blank the charts: if the filter matches nothing (e.g. stale focus
    // or signal-name drift), fall back to the full set.
    return filtered.length > 0 ? filtered : groups;
  });

  readonly chartsReady = computed(() => this.liveSignalGroups().length > 0);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['liveOnly']) {
      this.liveOnlyFlag.set(this.liveOnly);
    }
    if (changes['uploadOnly']) {
      this.uploadOnlyFlag.set(this.uploadOnly);
    }
    if (changes['autoSelectSessionId'] && 
      this.autoSelectSessionId &&
      this.autoSelectSessionId !== this.selectedSession()?.sessionId) {
    this.loadSessions(this.autoSelectSessionId);
  }
    if (changes['autoSelectLive'] && this.autoSelectLive) {
      this.loadSessions();
    }
  }

  // Frames currently visible (depends on playback position)
  visibleFrames = computed(() => this.telemetry.visibleFrames());

  /** Playhead X (seconds from session start) for chart overlays — smooth between frames */
  playheadRelativeTime = computed(() => this.telemetry.currentTime());

  /**
   * Playhead time to feed into chart datasets — only meaningful while an active
   * replay/scrub is in progress. When telemetry is 'stopped', `currentTime()` reflects
   * wherever the last-loaded (possibly paginated) frame page's playhead landed, not an
   * intentional scrub position — charts must show the full dataset in that case, or
   * switching chart mode (which recreates chart components) re-applies that stale
   * value as a filter and clips already-loaded data.
   */
  chartPlayheadTime = computed(() =>
    this.telemetry.state() === 'stopped' ? 0 : this.playheadRelativeTime()
  );

  /** Range input max index (avoid -1 when no frames) */
  sliderMaxIndex = computed(() =>
    Math.max(0, this.allFrames().length - 1),
  );

  readonly sliderPercent = computed(() => this.telemetry.progress());

  // Filter signals
  filterAddress = signal('');
  filterBus = signal('');
  // Advanced filter signals — wired to API query params
  faultsOnly = signal(false);
  anomalyOnly = signal(false);
  visibleMessages = signal<Set<string>>(new Set());
  visibleSignalNames = signal<Set<string>>(new Set());

  // Metadata-driven filter options — populated from /metadata API on session select.
  // Replaces the previous allFrames()-iterating computed signals.
  readonly sessionMsgIds      = signal<string[]>([]);
  readonly sessionBuses       = signal<string[]>([]);
  readonly sessionMessages    = signal<{ msgId: string; msgName: string }[]>([]);
  readonly sessionSignalNames = signal<string[]>([]);

  /**
   * Filter object passed to canService.getFrames().
   * All active filters go to the API — no client-side iteration over allFrames().
   */
  readonly frameApiFilters = computed(() => ({
    msgId:       this.filterAddress() || this.selectedMsgId() || undefined,
    bus:         this.filterBus() || undefined,
    faultsOnly:  this.faultsOnly(),
    anomalyOnly: this.anomalyOnly(),
  }));

  /**
   * CSV export URL for the selected session.
   * Used by the Export CSV anchor in the action bar.
   */
  readonly csvExportUrl = computed(() => {
    const session = this.selectedSession();
    if (!session) return '#';
    const token = localStorage.getItem('access_token') ?? '';
    // Note: token in URL is acceptable for file download endpoints
    // where Authorization header cannot be set on <a href>.
    return `${API_BASE_URL}/api/can/sessions/${session.sessionId}/frames/export.csv?token=${token}`;
  });

  /**
   * Map of frameId → IntegrityFault for O(1) lookup in the frame table.
   * Used to show ⚠ badge on frames with known faults.
   */
  readonly faultsByFrameId = computed(() => {
    const map = new Map<string, string>();
    for (const fault of this.integrityFaults()) {
      if (fault.msgId && fault.frameTimestamp != null) {
        map.set(`${fault.msgId}|${Math.round(fault.frameTimestamp)}`, fault.faultType);
      }
    }
    return map;
  });

  // ── Cross-view finding correlation (plan §3.2) ─────────────────────────────

  private readonly findingFocus = inject(FindingFocusService);

  /** Zoom window applied to every signal chart (chart-domain seconds). */
  readonly chartZoomRange = signal<{ min: number; max: number } | null>(null);
  readonly chartZoomLabel = signal('');

  /**
   * Finding markers over the charts: REQUIREMENT findings draw their violation
   * window (trigger → observed) as a shaded band, SPEC faults a single line.
   */
  readonly chartFindingMarkers = computed<FindingMarker[]>(() => {
    const base = this.sessionFirstTs();
    if (!base) return [];
    const rel = (t: number) => Math.max(0, t - base);
    const markers: FindingMarker[] = [];
    for (const f of this.integrityFaults()) {
      if (f.frameTimestamp == null) continue;
      if (f.layer === 'REQUIREMENT') {
        const start = this.findingWindowStart(f);
        const end = Math.max(f.frameTimestamp, f.lastSeenTs ?? 0);
        markers.push({
          time: rel(start ?? f.frameTimestamp),
          endTime: start != null ? rel(end) : undefined,
          color: f.faultType === 'REQUIREMENT_TIMING_VIOLATED' ? '#ff8c42' : '#ff4444',
          label: f.requirementId ?? f.faultType,
        });
      } else {
        markers.push({ time: rel(f.frameTimestamp), color: '#e3b341', label: f.faultType });
      }
    }
    return markers;
  });

  /** Requirement-violation windows in absolute seconds, for frame-row tinting. */
  readonly violationWindows = computed(() => {
    const windows: { start: number; end: number; label: string }[] = [];
    for (const f of this.integrityFaults()) {
      if (f.layer !== 'REQUIREMENT' || f.frameTimestamp == null) continue;
      const start = this.findingWindowStart(f) ?? f.frameTimestamp;
      const end = Math.max(f.frameTimestamp, f.lastSeenTs ?? 0);
      windows.push({ start, end, label: f.requirementId ?? f.faultType });
    }
    return windows;
  });

  /** Clicking a finding (requirements tab) zooms the charts to its window. */
  private readonly findingFocusEffect = effect(() => {
    const rawFocus = this.findingFocus.focus();
    // A focus is only meaningful for the session it was published from.
    const focus = rawFocus && (!rawFocus.sessionId
        || rawFocus.sessionId === this.selectedSession()?.sessionId)
      ? rawFocus : null;
    if (!focus) {
      this.chartZoomRange.set(null);
      this.chartZoomLabel.set('');
      return;
    }
    const base = this.sessionFirstTs();
    const pad = Math.max(0.5, (focus.end - focus.start) * 0.25);
    this.chartZoomRange.set({
      min: Math.max(0, focus.start - base - pad),
      max: Math.max(0.5, focus.end - base + pad),
    });
    this.chartZoomLabel.set(focus.label);
    if (focus.signals.length > 0) {
      this.visibleSignalNames.set(new Set(focus.signals));
    }
  });

  /** Window start (absolute seconds) from a finding's evidence, if it has one. */
  private findingWindowStart(f: IntegrityFault): number | null {
    const ev = f.evidence as Record<string, unknown> | null | undefined;
    const raw = ev?.['triggerTs'] ?? ev?.['enteredTs'];
    return typeof raw === 'number' ? raw : null;
  }

  clearChartZoom(): void {
    this.findingFocus.clear();
    this.visibleSignalNames.set(new Set());
  }

  // Frame stats — driven by session metadata, not by iterating allFrames().
  readonly frameStats = computed(() => ({
    total: this.selectedSession()?.frameCount ?? 0,
    buses: this.sessionBuses().length,
    addresses: this.sessionMsgIds().length,
  }));

  readonly filteredVisibleFrames = computed(() => {
    let frames = this.visibleFrames();
    // msgId, bus, and faultsOnly are already applied at the API level.
    // visibleMessages is a client-side multi-select overlay on the API result.
    const msgFilter = this.visibleMessages();
    if (msgFilter.size > 0) {
      frames = frames.filter((f) => msgFilter.has(f.msgId));
    }
    const sigFilter = this.visibleSignalNames();
    if (sigFilter.size > 0) {
      frames = frames.filter((f) => {
        if (!f.signals) return false;
        try {
          const parsed: Array<{ signal_name: string }> = JSON.parse(f.signals);
          return parsed.some((s) => sigFilter.has(s.signal_name));
        } catch {
          return false;
        }
      });
    }
    return frames;
  });

  /** Timestamp of the very first frame — used as relative time base (0.000s). */
  sessionFirstTs = computed(() => {
    const frames = this.allFrames();
    if (frames.length === 0) return this.selectedSession()?.startTs ?? 0;
    return frames[0].timestamp;
  });

  /** Timestamp of the very last frame — used for duration calculation. */
  sessionLastTs = computed(() => {
    const frames = this.allFrames();
    if (frames.length === 0) return this.selectedSession()?.endTs ?? 0;
    return frames[frames.length - 1].timestamp;
  });

  playbackDurationSec = signal(0);

  durationSeconds = computed(() => {
    const pDur = this.playbackDurationSec();
    if (pDur > 0) return pDur.toFixed(2);
    // For live sessions use real-time frame timestamps; for historical sessions
    // wait for InfluxDB data (playbackDurationSec) to avoid showing the paginated
    // 100-frame duration which is shorter than the actual session.
    if (!this.isLiveSession()) return '0';
    const first = this.sessionFirstTs();
    const last = this.sessionLastTs();
    if (!first || !last || last <= first) return '0';
    return (last - first).toFixed(2);
  });

  /** Recording date derived from first frame's absolute timestamp. */
  recordingDate = computed(() => {
    const frames = this.allFrames();
    if (frames.length === 0) return '—';
    const firstTs = frames[0].timestamp;
    // Convert Unix seconds to date string
    const date = new Date(firstTs * 1000);
    return date.toISOString().slice(0, 10);
  });

  // Groups frames by msg_id — one chart group per CAN message.
  // Called imperatively from buildLiveChartGroupBindings(); not reactive.
  private buildSignalGroups(): Array<{
    groupTitle: string;
    msgName: string;
    signalDefs: Array<{ signalName: string; color: string; allPoints: { x: number; y: number; label: string; frameIndex: number }[] }>;
  }> {
    let frames = this.allFrames();
    const session = this.selectedSession();
    if (!frames.length || !session) return [];

    const msgFilter = this.visibleMessages();
    if (msgFilter.size > 0) {
      frames = frames.filter((f) => msgFilter.has(f.msgId));
    }
    const palette = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
      '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
      '#ec4899', '#14b8a6', '#a855f7', '#eab308',
    ];

    // Build a map: msgId → { msgName, signals: Map<signalName, points[]> }
    const msgMap = new Map<string, {
      msgId: string;
      msgName: string;
      signals: Map<string, {
        allPoints: { x: number; y: number; label: string; frameIndex: number }[];
      }>;
    }>();

    const firstTs = this.sessionFirstTs();
    frames.forEach((frame, frameIndex) => {
      const relTime = parseFloat((frame.timestamp - firstTs).toFixed(3));
      const sigs = this.getSignals(frame);
      if (sigs.length === 0) return;

      if (!msgMap.has(frame.msgId)) {
        msgMap.set(frame.msgId, {
          msgId: frame.msgId,
          msgName: frame.msgName || frame.msgId,
          signals: new Map(),
        });
      }
      const group = msgMap.get(frame.msgId)!;
      // Groups are always built with the FULL signal set; the finding-focus /
      // signal filter is applied reactively in activeChartGroups so it can
      // never bake an empty or partial chart list into the loaded data.
      for (const sig of sigs) {
        if (!group.signals.has(sig.signal_name)) {
          group.signals.set(sig.signal_name, { allPoints: [] });
        }
        group.signals.get(sig.signal_name)!.allPoints.push({
          x: relTime,
          y: sig.raw_value,
          label: sig.label,
          frameIndex,
        });
      }
    });

    // CAN signals are sample-and-hold: extend each signal's last known value
    // to the end of the log, so zooming into a window after its last frame
    // (e.g. an event message that went quiet) still draws the held level.
    const lastFrame = frames[frames.length - 1];
    const maxRel = lastFrame
      ? parseFloat((lastFrame.timestamp - firstTs).toFixed(3)) : 0;

    // Convert map to array of groups sorted by msgId
    return [...msgMap.values()]
      .sort((a, b) => a.msgId.localeCompare(b.msgId))
      .map((g, groupIndex) => ({
        groupTitle: `${g.msgName} (${g.msgId})`,
        msgName: g.msgName,
        signalDefs: [...g.signals.entries()].map(([signalName, data], i) => {
          const pts = data.allPoints;
          const last = pts[pts.length - 1];
          if (last && last.x < maxRel) {
            pts.push({ ...last, x: maxRel });
          }
          return {
            signalName,
            color: palette[(groupIndex * 4 + i) % palette.length],
            allPoints: pts,
          };
        }),
      }))
      .filter((g) => g.signalDefs.length > 0);
  }

  ngOnInit(): void {
    this.liveOnlyFlag.set(this.liveOnly);
    this.uploadOnlyFlag.set(this.uploadOnly);

    // ── URL state restore on load ────────────────────────────────────────
    // Read sessionId from query params on first load so deep links work.
    // Example: /admin/sniffer?sessionId=abc-123 auto-selects that session.
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const sessionId = params['sessionId'];
        if (sessionId && !this.selectedSession()) {
          // Wait for sessions to load then auto-select
          const trySelect = () => {
            const found = this.sessions().find((s) => s.sessionId === sessionId);
            if (found) {
              this.selectSession(found);
            }
          };
          // Retry after sessions load (polling already runs in SessionListComponent)
          setTimeout(trySelect, 800);
          setTimeout(trySelect, 2000);
        }
      });

    this.liveTelemetry.frames$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((raw) => {
      const frame = this.normalizeLiveFrame(raw);
      const session = this.selectedSession();
      if (!session || frame.sessionId !== session.sessionId) return;

      // O(1) ring buffer push — signal update deferred to RAF loop
      this._frameBuffer.push(frame);
      if (this._frameBuffer.length > this.MAX_LIVE_FRAMES) {
        this._frameBuffer.shift();
      }
      this.liveFrames.update((current) => {
        const next = [...current, frame];
        return next.length > this.MAX_LIVE_FRAMES ? next.slice(-this.MAX_LIVE_FRAMES) : next;
      });
      this.telemetry.appendLiveFrame(frame);

      
      const relTime = parseFloat((frame.timestamp - this.sessionFirstTs()).toFixed(3));
      const signals = this.getSignals(frame);

      for (const sig of signals) {
        this.pendingChartPoints.push({
          signalName: sig.signal_name,
          point: { x: relTime, y: sig.raw_value, label: sig.label },
        });
        this.lastSignalValues.set(sig.signal_name, {
          value: sig.raw_value,
          label: sig.label,
          sessionStartTs: session.startTs,
        });
      }
      // Rebuild chart groups if not yet initialized
      if ((this.liveChartGroups() === null || this.liveChartGroups()!.length === 0)
          && this._frameBuffer.length > 2) {
        const groups = this.buildLiveChartGroupBindings();
        if (groups.length > 0) {
          this.liveChartGroups.set(groups);
          // Switch to charts tab on first data
          if (this.activeTab() !== 'charts') {
            setTimeout(() => this.setTab('charts'), 200);
          }
        }
      }

      this.lastRealFrameTime = Date.now();
      // Switch to charts tab when first live frames arrive
      if (this._frameBuffer.length === 1 && this.activeTab() !== 'charts') {
        setTimeout(() => this.setTab('charts'), 100);
      }
    });
    // Register the callback now; the WebSocket is activated only when a live session
    // is selected via connectToSession() — avoids a premature activate/disconnect race
    // that causes WSAECONNABORTED on Windows when a historical session is auto-selected.
    this.liveTelemetry.setSessionsCallback((updatedSessionJson: string) => {
      try {
        const updated = JSON.parse(updatedSessionJson);
        this.sessions.update(list =>
          list.map(s =>
            s.sessionId === updated.session_id
              ? { ...s, status: updated.status ?? s.status }
              : s
          )
        );
        const curSel = this.selectedSession();
        if (curSel && curSel.sessionId === updated.session_id) {
          this.selectedSession.set({
            ...curSel,
            status: updated.status ?? curSel.status ?? null,
          });
        }
        // If the currently selected live session just became COMPLETE
        const current = this.selectedSession();
        if (
          current &&
          current.sessionId === updated.session_id &&
          updated.status === 'COMPLETE' &&
          this.isLiveSession()
        ) {
          this.isLiveSession.set(false);
          this.stopLiveTicker();
          this.stopChartRaf();
          // Session just finished — load historical data from InfluxDB if charts tab is open
          if (this.activeTab() === 'charts' && !this.playbackActive() && !this.playbackComplete()) {
            setTimeout(() => this.loadAndDisplayAllFromInflux(), 500);
          }
        }
      } catch {
        // ignore parse errors
      }
    });
    this.loadSessions();
    this.loadCars();
  }

  loadCars(): void {
    this.canService.getCars()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (cars) => this.cars.set(cars), error: () => {} });
  }

  onVehicleFilterChange(carUid: string): void {
    this.selectedCarUid.set(carUid);
    // Filter sessions by vehicle — reload session list
    this.loadSessions();
  }

  ngOnDestroy(): void {
    this.replayEngine.stop();
    this.influxPlaybackSub?.unsubscribe();
    this.influxPlaybackSub = null;
    this.liveTelemetry.stopPlaybackSubscription();
    this.stopChartRaf();
    this.stopLiveTicker();
    this.telemetry.stop();
    // Only disconnect WebSocket if not in a live session
    // This preserves connection when navigating to dashboard
    if (!this.isLiveSession()) {
      this.liveTelemetry.disconnect();
    }
    if (this.simRefreshInterval !== null) {
      clearInterval(this.simRefreshInterval);
      this.simRefreshInterval = null;
    }
  }

  onSimulatorStarted(): void {
    setTimeout(() => {
      this.loadSessions(undefined, () => {
        const data = this.sessions();
        if (data[0]) {
          this.selectSession(data[0]);
        }
      });
    }, 3000);
    this.simRefreshInterval = setInterval(() => this.loadSessions(), 5000);
  }

  onSimulatorStopped(): void {
    this.stopChartRaf();
    this.pendingChartPoints = [];
    this.stopLiveTicker();
    this.isLiveSession.set(false);
    if (this.simRefreshInterval !== null) {
      clearInterval(this.simRefreshInterval);
      this.simRefreshInterval = null;
    }
    setTimeout(() => this.loadSessions(), 2000);
  }

  onUploadComplete(sessionId: string): void {
    // Wait for Kafka consumer to persist the session to MySQL before reloading
    setTimeout(() => {
      this.loadSessions(sessionId);
    }, 2000);
  }

  loadSessions(autoSelectSessionId?: string, onLoaded?: () => void): void {
    this.loadingSessions.set(true);
    this.currentPage.set(0);
    this.hasMore.set(true);

    const carUid = this.selectedCarUid();

    if (carUid) {
      this.canService.getSessionsByCar(carUid)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (items) => {
            this.sessions.set(items);
            this.hasMore.set(false);
            this.loadingSessions.set(false);
            if (autoSelectSessionId) {
              const found = items.find((s) => s.sessionId === autoSelectSessionId);
              if (found) this.selectSession(found);
            }
            onLoaded?.();
          },
          error: () => this.loadingSessions.set(false),
        });
      return;
    }

    this.canService.getSessionsPaged(0, this.pageSize).subscribe({
      next: (result) => {
        this.sessions.set(result.content);
        this.hasMore.set(result.hasMore);
        this.loadingSessions.set(false);
        if (autoSelectSessionId) {
          const found = result.content.find((s) => s.sessionId === autoSelectSessionId);
          if (found) this.selectSession(found);
        }
        onLoaded?.();
      },
      error: () => this.loadingSessions.set(false),
    });
  }

  loadMoreSessions(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    const nextPage = this.currentPage() + 1;
    this.canService.getSessionsPaged(nextPage, this.pageSize).subscribe({
      next: (result) => {
        this.sessions.update(current => [...current, ...result.content]);
        this.currentPage.set(nextPage);
        this.hasMore.set(result.hasMore);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false)
    });
  }

  deleteSession(session: CanSession, event: Event): void {
    event.stopPropagation(); // prevent row selection when clicking delete
    if (!confirm(`Delete session "${session.sourceFilename}" with ${session.frameCount} frames? This cannot be undone.`)) {
      return;
    }
    this.deletingSessionId.set(session.sessionId);
    this.canService.deleteSession(session.sessionId).subscribe({
      next: (result) => {
        this.toastService.show(
          `Session deleted — ${result.deletedFrames} frames removed`,
          'success'
        );
        // If deleted session was selected, clear selection
        if (this.selectedSession()?.sessionId === session.sessionId) {
          this.selectedSession.set(null);
          this.allFrames.set([]);
          this.telemetry.stop();
        }
        this.loadSessions();
        this.deletingSessionId.set(null);
      },
      error: (err) => {
        this.toastService.show('Failed to delete session', 'error');
        this.deletingSessionId.set(null);
      }
    });
  }

  selectSession(session: CanSession): void {
    this.selectedSession.set(session);
    this.selectedMsgId.set('');
    this.filterAddress.set('');
    this.filterBus.set('');
    this.visibleMessages.set(new Set());
    // Keep a finding-focus signal filter alive across the remount that happens
    // when the inspector switches from the Requirements tab to Charts — but
    // only for the session the focus was published from.
    const focus = this.findingFocus.focus();
    const focusApplies = !!focus
      && (!focus.sessionId || focus.sessionId === session.sessionId);
    this.visibleSignalNames.set(new Set(focusApplies ? focus!.signals : []));
    this.sessionMsgIds.set([]);
    this.sessionBuses.set([]);
    this.sessionMessages.set([]);
    this.sessionSignalNames.set([]);
    this.telemetry.stop();
    this.liveFrames.set([]);
    this._frameBuffer = [];
    this.liveChartGroups.set(null);
    this.replayEngine.reset();
    this.playbackComplete.set(false);
    this.playbackActive.set(false);
    this.playbackLoading.set(false);
    this.playbackPoints = [];
    this.pendingChartPoints = [];
    this.playbackDurationSec.set(0);
    this.influxPlaybackSub?.unsubscribe();
    this.influxPlaybackSub = null;

    const freshSession = this.sessions().find(s => s.sessionId === session.sessionId) ?? session;
    const isLive = this.sessionState.isLive(freshSession);
    this.isLiveSession.set(isLive);

  

    this.loadFrames(session.sessionId);
    this.loadIntegrity(session.sessionId);
    this.loadSessionMetadata(session.sessionId);

    if (isLive) {
      this.liveTelemetry.connectToSession(session.sessionId);
      this.lastSignalValues.clear();
      this.lastRealFrameTime = 0;
      this.startLiveTicker();
      this.startChartRaf();
      // Auto-switch to CHARTS tab for live sessions
      setTimeout(() => this.setTab('charts'), 300);
    } else {
      this.liveTelemetry.disconnect();
      this.stopLiveTicker();
      if (session.sourceFilename === 'live_simulation') {
        setTimeout(() => {
          if (this.selectedSession()?.sessionId === session.sessionId) {
            this.setTab('charts');
          }
        }, 300);
      }
    }

    // Sync selected session to URL for deep linking + back button support
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sessionId: session.sessionId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private startLiveTicker(): void {
    this.stopLiveTicker();
    this.liveTickInterval = setInterval(() => {
      if (
        this.lastRealFrameTime > 0 &&
        Date.now() - this.lastRealFrameTime > 10000
      ) {
        this.stopLiveTicker();
        this.isLiveSession.set(false);
        return;
      }

      const session = this.selectedSession();
      if (!session || !this.isLiveSession()) {
        this.stopLiveTicker();
        return;
      }
      if (this.lastSignalValues.size === 0) return;

      const relTime = parseFloat(
        (Date.now() / 1000 - this.sessionFirstTs()).toFixed(3),
      );
      if (relTime < 0) return;
      // Route through pendingChartPoints so RAF handles rendering
      // This prevents two competing update paths fighting each other
      this.lastSignalValues.forEach((sigState, signalName) => {
        this.pendingChartPoints.push({
          signalName,
          point: { x: relTime, y: sigState.value, label: sigState.label },
        });
      });
    }, 200);
  }

  private stopLiveTicker(): void {
    this.stopChartRaf();
    this.pendingChartPoints = [];
    if (this.liveTickInterval !== null) {
      clearInterval(this.liveTickInterval);
      this.liveTickInterval = null;
    }
  }

  private startChartRaf(): void {
    if (this.rafRunning) return;
    this.rafRunning = true;
    const loop = () => {
      // Update allFrames signal once per RAF — not once per Kafka message
      if (this._frameBuffer.length > 0 && this.isLiveSession()) {
        this.allFrames.set([...this._frameBuffer]);
        // Rebuild live chart groups when first frames arrive
        // This ensures SignalChartComponents exist before appendPoint is called
        if (this.liveChartGroups() === null || this.liveChartGroups()!.length === 0) {
          this.liveChartGroups.set(this.buildLiveChartGroupBindings());
        }
      }

      if (this.pendingChartPoints.length > 0 && this.chartComponents.length > 0) {
        const now = performance.now();
        // For live sessions: throttle chart updates to max 10 per second
        // This prevents burst rendering and makes lines smooth
        const throttleMs = this.isLiveSession() ? 50 : 0;
        if (now - this._lastChartUpdate >= throttleMs) {
          this._lastChartUpdate = now;
          // Live: cap at 150 points/frame to smooth bursts. Historical bulk
          // loads drain the whole queue in one frame — trickling a full log at
          // 150/frame redraws every chart dozens of times (visible flicker).
          const batch = this.isLiveSession()
            ? this.pendingChartPoints.splice(0, 150)
            : this.pendingChartPoints.splice(0);
          for (const { signalName, point } of batch) {
            this.chartComponents.forEach((chart) => {
              if (chart.datasets.some((d) => d.signalName === signalName)) {
                chart.appendPoint(signalName, point);
              }
            });
          }
          // Flush all charts once after processing entire batch
          this.chartComponents.forEach((chart) => chart.flushUpdate());
        }
      }

      // Historical session, queue drained, no replay running: nothing left to
      // render — stop instead of spinning at 60fps forever. Replay play/seek
      // paths call startChartRaf() again ('paused' keeps the loop alive so a
      // bar-driven resume() still renders without a restart hook).
      if (!this.isLiveSession()
          && this.pendingChartPoints.length === 0
          && !this.playbackActive()
          && this.replayEngine.state() === 'idle') {
        this.rafRunning = false;
        this.rafId = null;
        return;
      }

      if (this.rafRunning) {
        this.rafId = requestAnimationFrame(loop);
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopChartRaf(): void {
    this.rafRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private loadAndDisplayAllFromInflux(): void {
    const session = this.selectedSession();
    if (!session || this.playbackActive()) return;

    this.playbackActive.set(true);
    this.playbackLoading.set(true);
    this.pendingChartPoints = [];
    this.playbackPoints = [];
    this.playbackPointIndex = 0;
    this.playbackComplete.set(false);
    this.ownPlaybackId = null;
    this.influxPlaybackSub?.unsubscribe();
    this.influxPlaybackSub = null;

    this.liveTelemetry.subscribeToPlayback(session.sessionId);

    this.influxPlaybackSub = this.liveTelemetry.playback$.subscribe((event) => {
      if (event.type === 'start') {
        if (this.isForeignPlayback(event.playbackId)) return;
        this.playbackId.set(event.playbackId);
      } else if (event.type === 'point') {
        if (this.isForeignPlayback(event.playbackId)) return;
        this.playbackPoints.push({
          time: Number(event.time),
          signalName: String(event.signalName ?? ''),
          value: Number(event.value),
          label: String(event.label ?? ''),
          pid: event.playbackId ?? undefined,
        });
      } else if (event.type === 'complete') {
        if (this.isForeignPlayback(event.playbackId)) return;
        this.playbackLoading.set(false);
        this.influxPlaybackSub?.unsubscribe();
        this.influxPlaybackSub = null;
        this.liveTelemetry.stopPlaybackSubscription();
        this.playbackPoints.sort((a, b) => a.time - b.time);
        if (this.playbackPoints.length === 0) {
          this.playbackActive.set(false);
          this.playbackId.set(null);
          return;
        }
        if (this.playbackPoints.length >= 2) {
          const dur = this.playbackPoints[this.playbackPoints.length - 1].time - this.playbackPoints[0].time;
          this.playbackDurationSec.set(dur);
          // Feed the replay bar too — otherwise it shows "0.00s / 0.00s" until
          // the user presses Play (totalTime is reset on every selectSession).
          this.replayEngine.setDuration(dur);
        }
        // Datasets are filled inside the rebuild — no RAF trickle needed.
        this.buildChartGroupsFromPlayback();
        this.playbackActive.set(false);
        this.playbackId.set(null);
        this.playbackComplete.set(true);
      } else if (event.type === 'error') {
        this.playbackLoading.set(false);
        this.playbackActive.set(false);
        this.playbackId.set(null);
        this.influxPlaybackSub?.unsubscribe();
        this.influxPlaybackSub = null;
        this.liveTelemetry.stopPlaybackSubscription();
      }
    });

    // Wait for the STOMP subscription to be live before triggering the stream —
    // the backend starts publishing within milliseconds and events sent before
    // the subscription reach nobody, leaving the loading spinner stuck.
    this.liveTelemetry.awaitConnected().then(() => this.canService
      .startPlayback({
        sessionId: session.sessionId,
        startTs: session.startTs,
        endTs: session.endTs,
        speed: 1,
      })
      .subscribe({
        next: (res) => {
          this.ownPlaybackId = res.playbackId;
          // Purge points a concurrent foreign playback (e.g. the 3D twin's
          // buffering) slipped into the buffer before our own id was known.
          this.playbackPoints = this.playbackPoints.filter(
            (p) => !p.pid || p.pid === res.playbackId);
        },
        error: () => {
          // Mirrors the WS event.type === 'error' handler above — without this, a request-level
          // failure (before the WS 'start' event ever arrives) leaves playbackActive stuck true,
          // and loadAndDisplayAllFromInflux()'s early-return guard blocks any retry.
          this.playbackLoading.set(false);
          this.playbackActive.set(false);
          this.playbackId.set(null);
          this.influxPlaybackSub?.unsubscribe();
          this.influxPlaybackSub = null;
          this.liveTelemetry.stopPlaybackSubscription();
        },
      }));
  }

  private buildChartGroupsFromPlayback(): void {
    // Prefer message-grouped structure using InfluxDB frames (allFrames() loaded by selectSession)
    const grouped = this.buildLiveChartGroupBindings();
    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6', '#a855f7', '#eab308'];
    // allFrames() holds only the first page of MySQL frames — a sparse signal
    // whose frames all fall outside that page would get no dataset and its
    // playback points would be dropped silently. Add flat per-signal groups
    // for any playback signal the grouped structure doesn't cover.
    const covered = new Set(grouped.flatMap(g => g.datasets.map(d => d.signalName)));
    const missing = [...new Set(
      this.playbackPoints.map(p => p.signalName).filter((n): n is string => !!n && n !== 'N/A'),
    )].filter(n => !covered.has(n));
    const extra = missing.map((signalName, i) => ({
      groupTitle: signalName,
      msgName: signalName,
      datasets: [{ signalName, color: palette[(covered.size + i) % palette.length], points: [] }] as ChartDataset[],
    }));
    const groups = [...grouped, ...extra];
    // Fill the datasets BEFORE publishing the groups: chart components
    // initialize straight from ds.points, so the tab paints once with full
    // data instead of an empty-chart frame followed by a RAF point trickle.
    const byName = new Map<string, ChartDataset>();
    for (const g of groups) for (const d of g.datasets) byName.set(d.signalName, d);
    for (const { signalName, point } of this.playbackChartPoints()) {
      byName.get(signalName)?.points.push(point);
    }
    this.liveChartGroups.set(groups.length > 0 ? groups : null);
  }

  private showAllLoadedPoints(): void {
    this.pendingChartPoints = [];
    // Rebuild with datasets pre-filled — single paint, no RAF trickle.
    this.buildChartGroupsFromPlayback();
  }

  /**
   * Convert the buffered InfluxDB playback points into chart points.
   * CAN signals are sample-and-hold: each signal's last value is extended with
   * a synthetic point at the end of the log, so zooming into a window after a
   * signal's last frame (e.g. an event message that went quiet) still draws a
   * segment spanning the window instead of an empty plot.
   */
  private playbackChartPoints(): Array<{ signalName: string; point: { x: number; y: number; label: string } }> {
    const out: Array<{ signalName: string; point: { x: number; y: number; label: string } }> = [];
    const baseTs = this.playbackPoints[0]?.time;
    if (baseTs === undefined) return out;
    const lastBySignal = new Map<string, { x: number; y: number; label: string }>();
    let maxRel = 0;
    for (const pt of this.playbackPoints) {
      if (!pt.signalName || pt.signalName === 'N/A') continue;
      const relTime = Math.max(0, parseFloat((pt.time - baseTs).toFixed(3)));
      const point = { x: relTime, y: pt.value, label: pt.label };
      out.push({ signalName: pt.signalName, point });
      lastBySignal.set(pt.signalName, point);
      if (relTime > maxRel) maxRel = relTime;
    }
    lastBySignal.forEach((last, signalName) => {
      if (last.x < maxRel) {
        out.push({ signalName, point: { ...last, x: maxRel } });
      }
    });
    return out;
  }

  /** True when the chart datasets already carry rendered points. */
  private chartsPopulated(): boolean {
    return (this.liveChartGroups() ?? [])
      .some((g) => g.datasets.some((d) => d.points.length > 0));
  }

  private buildLiveChartGroupBindings(): Array<{
    groupTitle: string;
    msgName: string;
    datasets: ChartDataset[];
  }> {
    const groups = this.buildSignalGroups();
    if (groups.length === 0) return [];

    
    return groups.map((g) => ({
      groupTitle: g.groupTitle,
      msgName: g.msgName,
      datasets: g.signalDefs.map((d) => ({
        signalName: d.signalName,
        color: d.color,
        points: [], // Start empty — points added via appendPoint() in real-time
      })) as ChartDataset[],
    }));
  }

  private normalizeLiveFrame(raw: any): CanFrame {
    return {
      id: raw.id ?? 0,
      sessionId: raw.sessionId ?? raw.session_id ?? '',
      timestamp: raw.timestamp ?? 0,
      channel: raw.channel ?? 0,
      channelName: raw.channelName ?? raw.channel_name ?? '',
      msgId: raw.msgId ?? raw.msg_id ?? '',
      msgName: raw.msgName ?? raw.msg_name ?? '',
      direction: raw.direction ?? 'Rx',
      rawBytes:
        typeof raw.rawBytes === 'string'
          ? raw.rawBytes
          : JSON.stringify(raw.rawBytes ?? raw.raw_bytes ?? []),
      signals:
        typeof raw.signals === 'string'
          ? raw.signals
          : JSON.stringify(raw.signals ?? []),
    };
  }

  loadFrames(sessionId: string): void {
    this.loadingFrames.set(true);
    this.currentFramePage.set(0);
    this.hasMoreFrames.set(false);

    this.canService.getFrames(sessionId, this.frameApiFilters(), 0, this.framePageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          // faultsOnly/anomalyOnly → plain array; normal → Spring Page object
          const frames: CanFrame[]  = Array.isArray(data) ? data : (data.content ?? []);
          const hasMore: boolean    = Array.isArray(data) ? false : !data.last;
          const totalPages: number  = Array.isArray(data) ? 1 : (data.totalPages ?? 1);

          if (this.isLiveSession()) {
            const extra = this.liveFrames().filter(
              (lf) => !frames.some(
                (d) => d.msgId === lf.msgId
                    && Math.abs((d.timestamp ?? 0) - (lf.timestamp ?? 0)) < 1e-4,
              ),
            );
            const merged = [...frames, ...extra];
            this.allFrames.set(merged);
            this._frameBuffer = [...merged];
            this.telemetry.loadSession(merged);
            if (!this.liveChartGroups()?.length) {
              const groups = this.buildLiveChartGroupBindings();
              if (groups.length > 0) {
                this.liveChartGroups.set(groups);
              } else if (this.isLiveSession()) {
                // MySQL has no decoded frames yet — retry after 3s
                setTimeout(() => {
                  if (this.isLiveSession() && this.selectedSession()?.sessionId === sessionId && !this.liveChartGroups()?.length) {
                    this.loadFrames(sessionId);
                  }
                }, 3000);
              }
            }
          } else {
            this.allFrames.set(frames);
            this.telemetry.loadSession(frames);
            this.liveChartGroups.set(null);
            if (!this.playbackActive() && !this.playbackLoading()) {
              if (this.playbackPoints.length > 0) {
                if (this.activeTab() === 'charts') setTimeout(() => this.showAllLoadedPoints(), 100);
              } else if (this.playbackComplete()) {
                if (this.activeTab() === 'charts') this.loadAndDisplayAllFromInflux();
              } else {
                // Pre-load InfluxDB signal data in background so duration and chart data
                // are ready regardless of which tab the user opens first.
                setTimeout(() => this.loadAndDisplayAllFromInflux(), 300);
              }
            }
          }

          this.hasMoreFrames.set(hasMore);
          this.totalFramePages.set(totalPages);
          this.loadingFrames.set(false);
        },
        error: () => this.loadingFrames.set(false),
      });
  }

  goToFramePage(page: number): void {
    const session = this.selectedSession();
    if (!session || this.loadingFrames()) return;
    const clamped = Math.max(0, Math.min(page, this.totalFramePages() - 1));
    this.currentFramePage.set(clamped);
    this.loadingFrames.set(true);
    this.canService.getFrames(session.sessionId, this.frameApiFilters(), clamped, this.framePageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          const frames: CanFrame[] = Array.isArray(data) ? data : (data.content ?? []);
          const hasMore: boolean   = Array.isArray(data) ? false : !data.last;
          const totalPages: number = Array.isArray(data) ? 1 : (data.totalPages ?? 1);
          this.allFrames.set(frames);
          this.telemetry.loadSession(frames);
          this.hasMoreFrames.set(hasMore);
          this.totalFramePages.set(totalPages);
          this.loadingFrames.set(false);
        },
        error: () => this.loadingFrames.set(false),
      });
  }


  loadMoreFrames(): void {
    if (this.loadingMoreFrames() || !this.hasMoreFrames()) return;
    const session = this.selectedSession();
    if (!session) return;

    this.loadingMoreFrames.set(true);
    const nextPage = this.currentFramePage() + 1;

    this.canService.getFrames(session.sessionId, this.frameApiFilters(), nextPage, this.framePageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          const frames: CanFrame[] = Array.isArray(data) ? data : (data.content ?? []);
          const hasMore: boolean   = Array.isArray(data) ? false : !data.last;

          this.allFrames.update(current => [...current, ...frames]);
          this.telemetry.loadSession(this.allFrames());
          this.currentFramePage.set(nextPage);
          this.hasMoreFrames.set(hasMore);
          this.loadingMoreFrames.set(false);
        },
        error: () => this.loadingMoreFrames.set(false),
      });
  }

  filterByMsgId(msgId: string): void {
    this.selectedMsgId.set(msgId);
  }

  toggleMessage(msgId: string): void {
    const current = new Set(this.visibleMessages());
    if (current.has(msgId)) {
      current.delete(msgId);
    } else {
      current.add(msgId);
    }
    this.visibleMessages.set(current);
    this.onChartFilterChanged();
  }

  isMessageVisible(msgId: string): boolean {
    const set = this.visibleMessages();
    return set.size === 0 || set.has(msgId);
  }

  toggleSignalName(name: string): void {
    const current = new Set(this.visibleSignalNames());
    if (current.has(name)) {
      current.delete(name);
    } else {
      current.add(name);
    }
    // No rebuild: the signal filter is applied reactively in activeChartGroups;
    // rebuilding here wipes and refills every chart (visible flicker).
    this.visibleSignalNames.set(current);
  }

  isSignalNameVisible(name: string): boolean {
    const set = this.visibleSignalNames();
    return set.size === 0 || set.has(name);
  }

  private onChartFilterChanged(): void {
    if (this.isLiveSession() || this.activeTab() !== 'charts') return;
    if (this.playbackPoints.length > 0) {
      this.showAllLoadedPoints();
    } else if (!this.playbackActive() && !this.playbackLoading() && this.playbackComplete()) {
      this.loadAndDisplayAllFromInflux();
    }
  }

  onAddressFilterChange(value: string): void {
    this.filterAddress.set(value);
    // Reset downstream filters
    this.filterBus.set('');
    this.visibleMessages.set(new Set());
    this.visibleSignalNames.set(new Set());
  }

  onBusFilterChange(value: string): void {
    this.filterBus.set(value);
    // Reset downstream filters
    this.visibleMessages.set(new Set());
    this.visibleSignalNames.set(new Set());
  }

  clearAllFilters(): void {
    this.filterAddress.set('');
    this.filterBus.set('');
    this.visibleMessages.set(new Set());
    this.visibleSignalNames.set(new Set());
    this.filterByMsgId('');
    this.faultsOnly.set(false);
    this.anomalyOnly.set(false);
    const session = this.selectedSession();
    if (session) this.loadFrames(session.sessionId);
  }

  toggleFaultsOnly(): void {
    this.faultsOnly.update(v => !v);
    this.anomalyOnly.set(false); // mutually exclusive
    const session = this.selectedSession();
    if (session) this.loadFrames(session.sessionId);
  }

  toggleAnomalyOnly(): void {
    this.anomalyOnly.update(v => !v);
    this.faultsOnly.set(false); // mutually exclusive
    const session = this.selectedSession();
    if (session) this.loadFrames(session.sessionId);
  }

  navigateToAi(): void {
    const session = this.selectedSession();
    if (session) {
      this.router.navigate(['/admin/ai'], {
        queryParams: { sessionId: session.sessionId },
      });
    }
  }

  /** Space bar — toggle playback pause/resume (prevent page scroll) */
  @HostListener('document:keydown.space', ['$event'])
  onSpaceBar(event: Event): void {
    // Only handle if not typing in an input/textarea/select
    const tag = (event.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    event.preventDefault();
    const session = this.selectedSession();
    if (!session || this.isLiveSession()) return;
    this.togglePlayback();
  }

  /** Arrow Left — seek backward 1 second in playback */
  @HostListener('document:keydown.arrowleft', ['$event'])
  onArrowLeft(event: Event): void {
    const tag = (event.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const session = this.selectedSession();
    if (!session || this.isLiveSession()) return;

    const current = this.telemetry.currentTime();
    const target = Math.max(0, current - 1);
    // Find the frame index closest to target time
    const frames = this.allFrames();
    const idx = frames.findIndex(
      (f) => f.timestamp - session.startTs >= target,
    );
    if (idx >= 0) {
      this.telemetry.seekToPlayhead(idx);
    }
  }

  /** Arrow Right — seek forward 1 second in playback */
  @HostListener('document:keydown.arrowright', ['$event'])
  onArrowRight(event: Event): void {
    const tag = (event.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const session = this.selectedSession();
    if (!session || this.isLiveSession()) return;

    const current = this.telemetry.currentTime();
    const target = current + 1;
    const frames = this.allFrames();
    const idx = frames.findIndex(
      (f) => f.timestamp - session.startTs >= target,
    );
    if (idx >= 0) {
      this.telemetry.seekToPlayhead(idx);
    } else {
      // Jump to last frame
      this.telemetry.seekToPlayhead(frames.length - 1);
    }
  }

  togglePlayback(): void {
    if (this.telemetry.state() === 'playing') {
      this.telemetry.pause();
    } else {
      this.telemetry.play();
    }
  }

  onSliderInput(event: Event): void {
    this.onSeek(event);
  }

  setTab(tab: 'table' | 'charts' | 'integrity'): void {
    const override = this._tabOverride();
    if (override && tab !== override) return;
    this.activeTab.set(tab);
    if (tab === 'charts') {
      this.chartJsLoaded.set(true);
      if (this.isLiveSession()) {
        if (!this.liveChartGroups()?.length) {
          const groups = this.buildLiveChartGroupBindings();
          this.liveChartGroups.set(groups.length > 0 ? groups : null);
        }
      } else if (!this.playbackComplete() && !this.playbackActive()) {
        this.loadAndDisplayAllFromInflux();
      } else if (this.playbackComplete() && this.playbackPoints.length > 0
          && !this.chartsPopulated()) {
        // Re-entering the tab with already-filled datasets: chart components
        // re-init from the retained points — rebuilding would wipe every chart
        // and re-trickle the whole log (visible flicker).
        this.showAllLoadedPoints();
      }
    }
    if (tab === 'integrity' && this.selectedSession()) {
      this.loadIntegrity(this.selectedSession()!.sessionId);
    }
  }

  loadIntegrity(sessionId: string): void {
    this.loadingIntegrity.set(true);
    this.canService.getIntegritySummary(sessionId).subscribe({
      next: (s) => {
        this.integritySummary.set(s);
        this.loadingIntegrity.set(false);
      },
      error: () => this.loadingIntegrity.set(false),
    });
    this.canService.getIntegrityFaults(sessionId).subscribe({
      next: (f) => this.integrityFaults.set(f),
      error: () => {},
    });
  }

  // ── Inline diagnostic editing (Phase 5) ───────────────────────────────────
  private readonly authStore = inject(AuthStore);
  readonly editingFault = signal<IntegrityFault | null>(null);
  readonly canEditDiagnostics = computed(() => {
    const user = this.authStore.user();
    const isAdmin = user?.roles?.some(
      (r) => ['ADMIN', 'ROLE_ADMIN'].includes((r.name ?? '').trim().toUpperCase())) ?? false;
    return isAdmin || this.authStore.hasPermission('diagnostics:write');
  });

  openFaultEditor(fault: IntegrityFault): void {
    if (!this.canEditDiagnostics()) return;
    this.editingFault.set(fault);
  }

  onEditorSaved(): void {
    this.editingFault.set(null);
    const session = this.selectedSession();
    if (session) this.loadIntegrity(session.sessionId);
  }

  onEditorClosed(): void {
    this.editingFault.set(null);
  }

  setIntegrityFilter(filter: 'all' | 'DUPLICATE' | 'TIMING_GAP' | 'SIGNAL_RANGE' | 'COUNTER_ERROR'): void {
    this.integrityFilter.set(filter);
  }

  faultTypeLabel(type: string): string {
    switch (type) {
      case 'DUPLICATE': return 'Duplicate';
      case 'TIMING_GAP': return 'Timing Gap';
      case 'SIGNAL_RANGE': return 'Range Violation';
      case 'COUNTER_ERROR': return 'Counter Error';
      case 'SEQUENCE_REGRESSION': return 'Counter Reset';
      case 'MESSAGE_TIMEOUT': return 'Message Timeout';
      default: return type;
    }
  }

  faultTypeIcon(type: string): string {
    switch (type) {
      case 'DUPLICATE': return '⧉';
      case 'TIMING_GAP': return '⏱';
      case 'SIGNAL_RANGE': return '⚠';
      case 'COUNTER_ERROR': return '#';
      case 'SEQUENCE_REGRESSION': return '↺';
      case 'MESSAGE_TIMEOUT': return '⌛';
      default: return '•';
    }
  }

  /** Plain-language one-liner per fault type — teaches what each check means. */
  faultTypeDescription(type: string): string {
    switch (type) {
      case 'DUPLICATE': return 'The exact same frame arrived twice within 1 ms';
      case 'TIMING_GAP': return 'A periodic message arrived later than 3× its expected cycle';
      case 'SIGNAL_RANGE': return 'A signal carried a value outside its allowed catalogue set';
      case 'COUNTER_ERROR': return 'The frame counter skipped ahead — frames were lost';
      case 'SEQUENCE_REGRESSION': return 'The frame counter went backwards — replay or ECU reset';
      case 'MESSAGE_TIMEOUT': return 'A periodic message went silent — ECU stopped or stream ended';
      default: return '';
    }
  }

  /** Accent text color per fault type (matches the twin tab's palette). */
  faultTextClass(type: string): string {
    switch (type) {
      case 'DUPLICATE': return 'text-orange-400';
      case 'TIMING_GAP': return 'text-amber-400';
      case 'SIGNAL_RANGE': return 'text-red-400';
      case 'COUNTER_ERROR': return 'text-purple-400';
      case 'SEQUENCE_REGRESSION': return 'text-fuchsia-400';
      case 'MESSAGE_TIMEOUT': return 'text-cyan-400';
      default: return 'text-slate-400';
    }
  }

  /** Tinted container classes per fault type for the fault cards. */
  faultRowClass(type: string): string {
    switch (type) {
      case 'DUPLICATE': return 'bg-orange-400/[6%] border-orange-400/[15%]';
      case 'TIMING_GAP': return 'bg-amber-400/[6%] border-amber-400/[15%]';
      case 'SIGNAL_RANGE': return 'bg-red-400/[6%] border-red-400/[15%]';
      case 'COUNTER_ERROR': return 'bg-purple-400/[6%] border-purple-400/[15%]';
      case 'SEQUENCE_REGRESSION': return 'bg-fuchsia-400/[6%] border-fuchsia-400/[15%]';
      case 'MESSAGE_TIMEOUT': return 'bg-cyan-400/[6%] border-cyan-400/[15%]';
      default: return 'bg-zinc-800/40 border-zinc-700/40';
    }
  }

  faultRelativeTime(fault: IntegrityFault): string {
    const start = this.selectedSession()?.startTs ?? 0;
    return (fault.frameTimestamp - start).toFixed(3);
  }

  /** Last occurrence, relative to session start — null when never repeated. */
  faultLastSeenRelative(fault: IntegrityFault): string | null {
    if (fault.lastSeenTs == null || (fault.occurrences ?? 1) <= 1) return null;
    const start = this.selectedSession()?.startTs ?? 0;
    return (fault.lastSeenTs - start).toFixed(3);
  }

  /** One clickable filter card per spec check, in severity order. */
  readonly integrityTypeCards = computed(() => {
    const s = this.integritySummary();
    if (!s) return [];
    return [
      { type: 'SIGNAL_RANGE' as const, count: s.signalRangeViolations },
      { type: 'COUNTER_ERROR' as const, count: s.counterErrors },
      { type: 'TIMING_GAP' as const, count: s.timingGaps },
      { type: 'DUPLICATE' as const, count: s.duplicates },
    ];
  });

  /** Fault cards expanded to their full explanation (meaning/cause/context). */
  expandedFaultIds = signal<Set<number>>(new Set());

  toggleFaultExpand(id: number): void {
    this.expandedFaultIds.update(ids => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  loadSessionMetadata(sessionId: string): void {
    this.canService.getSessionMetadata(sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: meta => {
          this.sessionMsgIds.set(meta.msgIds);
          this.sessionBuses.set(meta.buses);
          this.sessionMessages.set(meta.messages);
          this.sessionSignalNames.set(meta.signalNames);
        },
        error: () => {},
      });
  }

  getSignals(frame: CanFrame) {
    return parseSignals(frame.signals);
  }

  relativeTime(frame: CanFrame): string {
    return (
      (frame.timestamp - this.sessionFirstTs()).toFixed(3) +
      's'
    );
  }

  onSeek(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.telemetry.seekToPlayhead(val);
  }

  setSpeed(speed: number): void {
    this.telemetry.setSpeed(speed);
  }

  startInfluxPlayback(): void {
    const session = this.selectedSession();
    if (!session || this.playbackActive()) return; // prevent multiple starts

    // Always start fresh — clear all chart data before replay
    this.pendingChartPoints = [];
    this.chartComponents?.toArray().forEach((chart) => chart.clear());
    this.playbackPoints = [];
    this.playbackPointIndex = 0;
    this.playbackComplete.set(false);
    this.ownPlaybackId = null;

    // Set active immediately to prevent multiple clicks before WS confirms
    this.playbackActive.set(true);
    this.playbackLoading.set(true);

    this.influxPlaybackSub?.unsubscribe();
    this.influxPlaybackSub = null;

    this.liveTelemetry.subscribeToPlayback(session.sessionId);

    this.influxPlaybackSub = this.liveTelemetry.playback$.subscribe((point) => {
        if (point.type === 'start') {
          if (this.isForeignPlayback(point.playbackId)) return;
          this.playbackId.set(point.playbackId);
          this.playbackSessionStartTs =
            Number((point as { sessionStartTs?: number }).sessionStartTs) || session.startTs;
        } else if (point.type === 'point') {
          if (this.isForeignPlayback(point.playbackId)) return;
          const pt = {
            time: Number(point.time),
            signalName: String(point.signalName ?? ''),
            value: Number(point.value),
            label: String(point.label ?? ''),
            pid: point.playbackId ?? undefined,
          };
          const isFirstPoint = this.playbackPoints.length === 0;
          this.playbackPoints.push(pt);
          this.replayEngine.pointsLoaded.set(this.playbackPoints.length);
          if (isFirstPoint && this.playbackPointIndex === 0) {
            this.playbackLoading.set(false);
            this.startChartRaf();
            // Start the engine clock — the onTick callback drives chart rendering
            this.replayEngine.play(0);
            this.replayEngine.pointsLoaded.set(0);
          } else if (isFirstPoint && this.playbackPointIndex > 0) {
            this.playbackLoading.set(false);
          }
        } else if (point.type === 'complete') {
          if (this.isForeignPlayback(point.playbackId)) return;
          this.playbackLoading.set(false);
          this.influxPlaybackSub?.unsubscribe();
          this.influxPlaybackSub = null;
          this.liveTelemetry.stopPlaybackSubscription();
          // Sort once after all points received — fixes interleaved 
          // multi-table ordering from InfluxDB streaming
          this.playbackPoints.sort((a, b) => a.time - b.time);
          if (this.playbackPoints.length === 0) {
            this.playbackActive.set(false);
            this.playbackId.set(null);
            this.playbackComplete.set(false);
          }
        } else if (point.type === 'error') {
          this.replayEngine.stop();
          this.playbackLoading.set(false);
          this.playbackPoints = [];
          this.playbackPointIndex = 0;
          this.playbackActive.set(false);
          this.playbackId.set(null);
          this.playbackComplete.set(false);
          this.influxPlaybackSub?.unsubscribe();
          this.influxPlaybackSub = null;
          this.liveTelemetry.stopPlaybackSubscription();
        }
      });

    // Start the stream only once the STOMP subscription is live (see charts load).
    this.liveTelemetry.awaitConnected().then(() => this.canService
      .startPlayback({
        sessionId: session.sessionId,
        startTs: session.startTs,
        endTs: session.endTs,
        speed: this.telemetry.speed(),
      })
      .subscribe({
        next: (res) => {
          this.ownPlaybackId = res.playbackId;
          this.playbackPoints = this.playbackPoints.filter(
            (p) => !p.pid || p.pid === res.playbackId);
        },
        error: () => {
          // Mirrors the WS point.type === 'error' handler above — a request-level failure
          // (before the WS 'start' event arrives) would otherwise leave playbackActive stuck true.
          this.replayEngine.stop();
          this.playbackLoading.set(false);
          this.playbackPoints = [];
          this.playbackPointIndex = 0;
          this.playbackActive.set(false);
          this.playbackId.set(null);
          this.playbackComplete.set(false);
          this.influxPlaybackSub?.unsubscribe();
          this.influxPlaybackSub = null;
          this.liveTelemetry.stopPlaybackSubscription();
        },
      }));
  }

  stopInfluxPlayback(): void {
    const id = this.playbackId();
    if (id) {
      // Ignore 404 — server playback may have already completed
      this.canService.stopPlayback(id).subscribe({
        error: () => {}, // silent — server job already finished
      });
    }
    this.playbackLoading.set(false);
    this.playbackId.set(null);
    this.playbackActive.set(false);
    this.playbackComplete.set(false);
    this.influxPlaybackSub?.unsubscribe();
    this.influxPlaybackSub = null;
    this.liveTelemetry.stopPlaybackSubscription();
  }

  onReplayPlay(): void {
    const session = this.selectedSession();
    if (!session) return;

    this.replayEngine.setDuration(parseFloat(this.durationSeconds()));
    this.replayEngine.setSpeed(this.telemetry.speed());
    this.replayEngine.setLoading();

    this.pendingChartPoints = [];
    this.chartComponents?.toArray().forEach((chart) => chart.clear());
    this.playbackPoints = [];
    this.playbackPointIndex = 0;

    // Single unified tick — drives both frame-table scroll and chart-point rendering.
    // Replaces the parallel setInterval that was previously in startPlaybackClock().
    this.replayEngine.onTick((currentRelTime) => {
      // Sync frame table to playhead
      const frames = this.allFrames();
      const firstTs = this.sessionFirstTs();
      const targetTs = firstTs + currentRelTime;
      let idx = frames.length - 1;
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].timestamp > targetTs) { idx = Math.max(0, i - 1); break; }
      }
      this.telemetry.seekTo(idx);

      // Process buffered InfluxDB points up to currentRelTime
      if (this.playbackPoints.length > 0) {
        const baseTs = this.playbackPoints[0].time;
        const targetLogTime = baseTs + currentRelTime;
        const batchMap = new Map<string, { signalName: string; relTime: number; y: number; label: string }>();
        while (
          this.playbackPointIndex < this.playbackPoints.length &&
          this.playbackPoints[this.playbackPointIndex].time <= targetLogTime
        ) {
          const pt = this.playbackPoints[this.playbackPointIndex];
          if (pt.signalName) {
            const relTime = Math.max(0, parseFloat((pt.time - baseTs).toFixed(3)));
            batchMap.set(`${pt.signalName}__${relTime}`, { signalName: pt.signalName, relTime, y: pt.value, label: pt.label });
          }
          this.playbackPointIndex++;
        }
        batchMap.forEach((e) => {
          this.pendingChartPoints.push({ signalName: e.signalName, point: { x: e.relTime, y: e.y, label: e.label } });
        });

        // Auto-complete when all points consumed and the stream is closed
        if (this.playbackPointIndex >= this.playbackPoints.length && !this.influxPlaybackSub) {
          this.replayEngine.pause();
          this.playbackActive.set(false);
          this.playbackId.set(null);
          this.playbackComplete.set(true);
        }
      }

      this.replayEngine.pointsRendered.set(this.playbackPointIndex);
    });

    // Register seek — redraws charts from buffer up to seek position
    this.replayEngine.onSeek((targetSeconds) => {
      if (this.playbackPoints.length === 0) return;
      const baseTs = this.playbackPoints[0].time;
      const targetLogTime = baseTs + targetSeconds;
      const idx = this.playbackPoints.findIndex(p => p.time >= targetLogTime);
      this.playbackPointIndex = Math.max(0, idx === -1 ? this.playbackPoints.length : idx);
      this.pendingChartPoints = [];
      this.chartComponents?.toArray().forEach((chart) => chart.clear());
      const batchMap = new Map<string, { signalName: string; relTime: number; y: number; label: string }>();
      for (let i = 0; i < this.playbackPointIndex; i++) {
        const pt = this.playbackPoints[i];
        const relTime = Math.max(0, parseFloat((pt.time - baseTs).toFixed(3)));
        batchMap.set(`${pt.signalName}__${relTime}`, { signalName: pt.signalName, relTime, y: pt.value, label: pt.label });
      }
      batchMap.forEach((e) => {
        this.pendingChartPoints.push({ signalName: e.signalName, point: { x: e.relTime, y: e.y, label: e.label } });
      });
      this.startChartRaf();
    });

    this.startInfluxPlayback();
  }

  onReplayStop(): void {
    this.stopInfluxPlayback();
    this.replayEngine.stop();
    if (!this.isLiveSession()) {
      setTimeout(() => this.loadAndDisplayAllFromInflux(), 100);
    }
  }

  onReplaySeek(targetSeconds: number): void {
    this.replayEngine.seek(targetSeconds);
  }

  showAllPlaybackPoints(): void {
    const session = this.selectedSession();
    if (!session || this.playbackPoints.length === 0) return;

    this.pendingChartPoints = this.playbackChartPoints();
    this.chartComponents?.toArray().forEach((chart) => chart.clear());
    if (!this.isLiveSession()) {
      this.startChartRaf();
    }
    this.playbackComplete.set(true);
    this.playbackPointIndex = this.playbackPoints.length;
  }

}
