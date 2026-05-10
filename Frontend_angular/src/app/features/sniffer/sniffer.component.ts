import {
  Component,
  OnInit,
  OnDestroy,
  OnChanges,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  DestroyRef,
  ViewChildren,
  QueryList,
  Input,
  SimpleChanges,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CanService } from '../../core/services/can.service';
import { ToastService } from '../../core/services/toast.service';
import { TelemetryService } from '../../core/services/telemetry.service';
import { LiveTelemetryService } from '../../core/services/live-telemetry.service';
import { CanSession, CanFrame, parseSignals, IntegrityFault, IntegritySummary } from '../../data/models/can.model';
import {
  SignalChartComponent,
  ChartDataset,
} from './signal-chart/signal-chart.component';
import { LogUploadComponent } from './upload/log-upload.component';
import { SimulatorControlComponent } from './simulator/simulator-control.component';
import { SessionListComponent } from './session-list/session-list.component';

@Component({
  selector: 'app-sniffer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, SignalChartComponent, LogUploadComponent, SimulatorControlComponent, SessionListComponent],
  templateUrl: './sniffer.component.html',
  styleUrl: './sniffer.component.scss',
})
export class SnifferComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChildren(SignalChartComponent) chartComponents!: QueryList<SignalChartComponent>;

  @Input() hideUpload = false;
  @Input() hideSimulator = false;
  @Input() liveOnly = false;
  @Input() uploadOnly = false;
  @Input() autoSelectLive = false;
  @Input() autoSelectSessionId: string | undefined = undefined;
  /** Live Monitor KPIT styling: lime primary line height, taller canvases — see monitor-page.component.scss */
  @Input() kpitMonitorChartTheme = false;

  /** Mirrors `liveOnly` input so `filteredSessions` stays reactive with signals. */
  private readonly liveOnlyFlag = signal(false);
  private uploadOnlyFlag = signal(false);

  readonly filteredSessions = computed(() => {
    if (this.liveOnlyFlag()) {
      return this.sessions().filter((s) => s.sourceFilename === 'live_simulation');
    }
    if (this.uploadOnlyFlag()) {
      return this.sessions().filter((s) => s.sourceFilename !== 'live_simulation');
    }
    return this.sessions();
  });

  private canService = inject(CanService);
  private toastService = inject(ToastService);
  readonly telemetry = inject(TelemetryService);
  readonly liveTelemetry = inject(LiveTelemetryService);
  // Example: reactive stream for Engine_RPM_High signal
  readonly engineRpm$ = this.liveTelemetry.getSignalStream('Engine_RPM_High');
  private destroyRef = inject(DestroyRef);

  private simRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private liveTickInterval: ReturnType<typeof setInterval> | null = null;
  private lastSignalValues = new Map<
    string,
    { value: number; label: string; sessionStartTs: number }
  >();
  private lastRealFrameTime = 0;

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
  activeTab = signal<'table' | 'charts' | 'integrity'>('table');
  chartMode = signal<'stacked' | 'combined'>('stacked');
  chartJsLoaded = signal(false);

  integritySummary = signal<IntegritySummary | null>(null);
  integrityFaults = signal<IntegrityFault[]>([]);
  loadingIntegrity = signal(false);

  // All frames for the selected session (from MySQL)
  allFrames = signal<CanFrame[]>([]);

  isLiveSession = signal(false);
  liveFrames = signal<CanFrame[]>([]);

  // InfluxDB server-side playback
  playbackId = signal<string | null>(null);
  playbackActive = signal(false);
  playbackLoading = signal(false); // true while receiving points from server
  playbackComplete = signal(false); // true when all points have been displayed
  playbackPoints: Array<{time: number; signalName: string; value: number; label: string}> = [];
  private playbackStartWallTime = 0;
  private playbackStartLogTime = 0;
  private playbackSpeed = 1;
  private playbackTimer: ReturnType<typeof setInterval> | null = null;
  private playbackPointIndex = 0;
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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['liveOnly']) {
      this.liveOnlyFlag.set(this.liveOnly);
    }
    if (changes['uploadOnly']) {
      this.uploadOnlyFlag.set(this.uploadOnly);
    }
    if (changes['autoSelectSessionId'] && this.autoSelectSessionId) {
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

  /** Range input max index (avoid -1 when no frames) */
  sliderMaxIndex = computed(() =>
    Math.max(0, this.allFrames().length - 1),
  );

  readonly sliderPercent = computed(() => this.telemetry.progress());

  uniqueMsgIds = computed(() =>
    [...new Set(this.allFrames().map((f) => f.msgId).filter(Boolean))],
  );

  // Filter signals
  filterAddress = signal('');
  filterBus = signal('');
  visibleMessages = signal<Set<string>>(new Set());
  visibleSignalNames = signal<Set<string>>(new Set());

  // Buses filtered by selected address
  readonly uniqueBuses = computed(() => {
    const frames = this.filterAddress()
      ? this.allFrames().filter((f) => f.msgId === this.filterAddress())
      : this.allFrames();
    return [...new Set(frames.map((f) => f.channelName).filter(Boolean))];
  });

  // Signal names filtered by selected address + bus
  readonly uniqueSignalNames = computed(() => {
    const names = new Set<string>();
    this.allFrames()
      .filter(
        (f) =>
          (!this.filterAddress() || f.msgId === this.filterAddress()) &&
          (!this.filterBus() || f.channelName === this.filterBus()),
      )
      .forEach((f) => this.getSignals(f).forEach((s) => names.add(s.signal_name)));
    return [...names].sort();
  });

  // Messages filtered by selected address + bus
  readonly uniqueMessages = computed(() => {
    const map = new Map<string, string>();
    this.allFrames()
      .filter(
        (f) =>
          (!this.filterAddress() || f.msgId === this.filterAddress()) &&
          (!this.filterBus() || f.channelName === this.filterBus()),
      )
      .forEach((f) => map.set(f.msgId, f.msgName));
    return [...map.entries()].map(([msgId, msgName]) => ({ msgId, msgName }));
  });

  // Frame stats
  readonly frameStats = computed(() => {
    const frames = this.allFrames();
    const buses = new Set(frames.map((f) => f.channelName).filter(Boolean));
    const addresses = new Set(frames.map((f) => f.msgId).filter(Boolean));
    return {
      total: frames.length,
      buses: buses.size,
      addresses: addresses.size,
    };
  });

  readonly filteredVisibleFrames = computed(() => {
    let frames = this.visibleFrames();

    // Filter by selected msg ID pill
    if (this.selectedMsgId()) {
      frames = frames.filter((f) => f.msgId === this.selectedMsgId());
    }

    // Filter by address dropdown
    if (this.filterAddress()) {
      frames = frames.filter((f) => f.msgId === this.filterAddress());
    }

    // Filter by bus dropdown
    if (this.filterBus()) {
      frames = frames.filter((f) => f.channelName === this.filterBus());
    }

    // Filter by visible messages checklist
    const msgFilter = this.visibleMessages();
    if (msgFilter.size > 0) {
      frames = frames.filter((f) => msgFilter.has(f.msgId));
    }

    return frames;
  });

  durationSeconds = computed(() => {
    const s = this.selectedSession();
    return s ? (s.endTs - s.startTs).toFixed(2) : '0';
  });

  // Built when session / full frame list changes — stable group/color structure
  allSignalGroups = computed(() => {
    const frames = this.allFrames();
    const session = this.selectedSession();
    if (!frames.length || !session) return [];

    const groups = [
      {
        groupTitle: 'Door Latch & Lock State',
        msgName: 'Car_Status',
        signalKeys: ['0x2FC__door_latche_status', '0x2FC__selective_unlock_statuss'],
      },
      {
        groupTitle: 'Door Open/Close Status',
        msgName: 'Car_Status',
        signalKeys: ['0x2FC__Drd_Status', '0x2FC__PSD_Status', '0x2FC__DRDR_Status', '0x2FC__Psdr_Status'],
      },
      {
        groupTitle: 'Bootlid & Rocker Switch',
        msgName: 'Car_Status',
        signalKeys: ['0x2FC__Bootlid_Status', '0x2FC__Rocker_switch_Status'],
      },
      {
        groupTitle: 'Key Button Presses',
        msgName: 'Key_Button_Status',
        signalKeys: ['0x23A__Unlock_Button_status', '0x23A__lock_Button_status', '0x23A__3rd_Button_status'],
      },
      {
        groupTitle: 'Contact Status — Doors',
        msgName: 'Contact_Status',
        signalKeys: ['0x2CA__Drd_Status_Cont', '0x2CA__PSD_Status_Cont', '0x2CA__DRDR_Status_Cont', '0x2CA__Psdr_Status_Cont'],
      },
      {
        groupTitle: 'Contact Status — Bootlid',
        msgName: 'Contact_Status',
        signalKeys: ['0x2CA__Bootlid_Status_Cont'],
      },
      {
        groupTitle: 'Latch Secure Actions',
        msgName: 'Latch_Action',
        signalKeys: ['0x2AF__Drd_Secure_latch_action', '0x2AF__Drdr_Secure_latch_action', '0x2AF__Psd_Secure_latch_action', '0x2AF__Psdr_Secure_latch_action'],
      },
      {
        groupTitle: 'Latch Lock Actions',
        msgName: 'Latch_Action',
        signalKeys: ['0x2AF__Drd_Lock_latch_action', '0x2AF__Drdr_Lock_latch_action', '0x2AF__Psd_Lock_latch_action', '0x2AF__Psdr_Lock_latch_action'],
      },
      {
        groupTitle: 'Latch Unlock Actions',
        msgName: 'Latch_Action',
        signalKeys: ['0x2AF__Drd_Unlock_latch_action', '0x2AF__Drdr_Unlock_latch_action', '0x2AF__Psd_Unlock_latch_action', '0x2AF__Psdr_Unlock_latch_action'],
      },
      {
        groupTitle: 'Key Position & Button',
        msgName: 'key_comm',
        signalKeys: ['0x723__KEY_Pos', '0x723__KEY_Butt'],
      },
    ];

    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

    const pointMap = new Map<string, { allPoints: { x: number; y: number; label: string; frameIndex: number }[] }>();
    frames.forEach((frame, frameIndex) => {
      const relTime = parseFloat((frame.timestamp - session.startTs).toFixed(3));
      const sigs = this.getSignals(frame);
      for (const sig of sigs) {
        const key = `${frame.msgId}__${sig.signal_name}`;
        if (!pointMap.has(key)) pointMap.set(key, { allPoints: [] });
        pointMap.get(key)!.allPoints.push({
          x: relTime,
          y: sig.raw_value,
          label: sig.label,
          frameIndex,
        });
      }
    });

    return groups
      .map((group) => ({
        groupTitle: group.groupTitle,
        msgName: group.msgName,
        signalDefs: group.signalKeys
          .map((key, i) => ({
            signalName: key.split('__')[1],
            color: palette[i % palette.length],
            allPoints: pointMap.get(key)?.allPoints ?? [],
          }))
          .filter((d) => d.allPoints.length > 0)
          .map((d, idx) => ({
            ...d,
            color:
              this.kpitMonitorChartTheme && idx === 0 ? '#b0ff44' : d.color,
          })),
      }))
      .filter((g) => g.signalDefs.length > 0);
  });

  // Per playback tick — only slices existing point arrays (stable group identities)
  signalTimelines = computed(() => {
    const maxIndex = this.telemetry.playbackIndex();
    return this.allSignalGroups().map((group) => ({
      groupTitle: group.groupTitle,
      msgName: group.msgName,
      datasets: group.signalDefs.map((def) => ({
        signalName: def.signalName,
        color: def.color,
        points: def.allPoints
          .filter((p) => p.frameIndex <= maxIndex)
          .map(({ x, y, label }) => ({ x, y, label })),
      })) as ChartDataset[],
    }));
  });

  ngOnInit(): void {
    this.liveOnlyFlag.set(this.liveOnly);
    this.uploadOnlyFlag.set(this.uploadOnly);
    this.liveTelemetry.frames$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((raw) => {
      const frame = this.normalizeLiveFrame(raw);
      const session = this.selectedSession();
      if (!session || frame.sessionId !== session.sessionId) return;

      const updatedFrames = [...this.allFrames(), frame];
      this.allFrames.set(updatedFrames);
      this.liveFrames.update((current) => [...current, frame]);
      this.telemetry.appendLiveFrame(frame);

      const relTime = parseFloat((frame.timestamp - session.startTs).toFixed(3));
      const signals = this.getSignals(frame);

      for (const sig of signals) {
        // Buffer chart points instead of updating immediately
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

      this.lastRealFrameTime = Date.now();
    });
    this.loadSessions();
  }

  ngOnDestroy(): void {
    this.stopPlaybackClock();
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
    this.canService.getSessionsPaged(0, this.pageSize).subscribe({
      next: (result) => {
        this.sessions.set(result.content);
        this.hasMore.set(result.hasMore);
        this.loadingSessions.set(false);
        if (autoSelectSessionId) {
          const found = result.content.find(s => s.sessionId === autoSelectSessionId);
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
    this.visibleSignalNames.set(new Set());
    this.telemetry.stop();
    this.liveFrames.set([]);
    this.liveChartGroups.set(null);

    const isLive = session.sourceFilename === 'live_simulation' || session.frameCount === 0;
    this.isLiveSession.set(isLive);

    this.loadFrames(session.sessionId);
    this.loadIntegrity(session.sessionId);

    if (isLive) {
      this.liveTelemetry.connectToSession(session.sessionId);
      this.lastSignalValues.clear();
      this.lastRealFrameTime = 0;
      this.startLiveTicker();
      this.startChartRaf();
    } else {
      this.liveTelemetry.disconnect();
      this.stopLiveTicker();
    }
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
        (Date.now() / 1000 - session.startTs).toFixed(3),
      );
      if (relTime < 0) return;

      this.lastSignalValues.forEach((sigState, signalName) => {
        const point = { x: relTime, y: sigState.value, label: sigState.label };
        this.chartComponents?.forEach((chart) => {
          const ds = chart.datasets.find((d) => d.signalName === signalName);
          if (ds) chart.appendPoint(signalName, point);
        });
      });
      this.chartComponents?.forEach((chart) => chart.flushUpdate());
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
      if (this.pendingChartPoints.length > 0) {
        const batch = this.pendingChartPoints.splice(0);
        for (const { signalName, point } of batch) {
          this.chartComponents?.forEach((chart) => {
            if (chart.datasets.some((d) => d.signalName === signalName)) {
              chart.appendPoint(signalName, point);
            }
          });
        }
        // Flush all charts once after processing entire batch
        this.chartComponents?.forEach((chart) => chart.flushUpdate());
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

  private buildLiveChartGroupBindings(): Array<{
    groupTitle: string;
    msgName: string;
    datasets: ChartDataset[];
  }> {
    return this.allSignalGroups().map((g) => ({
      groupTitle: g.groupTitle,
      msgName: g.msgName,
      datasets: g.signalDefs.map((d) => ({
        signalName: d.signalName,
        color: d.color,
        points: d.allPoints.map((p) => ({ x: p.x, y: p.y, label: p.label })),
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
    this.canService.getFrames(sessionId).subscribe({
      next: (data) => {
        if (this.isLiveSession()) {
          const extra = this.liveFrames().filter(
            (lf) =>
              !data.some(
                (d) =>
                  (d.id > 0 && lf.id > 0 && d.id === lf.id) ||
                  (d.msgId === lf.msgId &&
                    Math.abs(d.timestamp - lf.timestamp) < 1e-4),
              ),
          );
          const merged = [...data, ...extra];
          this.allFrames.set(merged);
          this.telemetry.loadSession(merged);
          this.liveChartGroups.set(this.buildLiveChartGroupBindings());
        } else {
          this.allFrames.set(data);
          this.telemetry.loadSession(data);
          this.liveChartGroups.set(null);
        }
        this.loadingFrames.set(false);
      },
      error: () => this.loadingFrames.set(false),
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
    this.visibleSignalNames.set(current);
  }

  isSignalNameVisible(name: string): boolean {
    const set = this.visibleSignalNames();
    return set.size === 0 || set.has(name);
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
    this.activeTab.set(tab);
    if (tab === 'charts') {
      this.loadChartJs();
      if (this.isLiveSession()) {
        this.liveChartGroups.set(this.buildLiveChartGroupBindings());
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

  loadChartJs(): void {
    // Chart.js is now bundled via node_modules — no CDN required.
    // This allows the app to work offline (demo venue Wi-Fi may be restricted).
    // Registration is done at module level in signal-chart.component.ts.
    this.chartJsLoaded.set(true);
  }

  getSignals(frame: CanFrame) {
    return parseSignals(frame.signals);
  }

  relativeTime(frame: CanFrame): string {
    return (
      (frame.timestamp - (this.selectedSession()?.startTs ?? 0)).toFixed(3) +
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

    // If full data already displayed (Show All or completed) — start fresh
    // If stopped mid-way — continue from where we left off
    const freshStart = this.playbackComplete() || this.playbackPoints.length === 0;
    if (freshStart) {
      this.pendingChartPoints = [];
      this.chartComponents?.toArray().forEach((chart) => chart.clear());
      this.playbackPoints = [];
      this.playbackPointIndex = 0;
      this.playbackComplete.set(false);
    } else {
      // Resume from stopped point — don't clear charts or points
      // playbackPointIndex already set to where we stopped
      if (this.playbackPointIndex < this.playbackPoints.length) {
        this.playbackStartLogTime = this.playbackPoints[this.playbackPointIndex].time;
        this.playbackStartWallTime = Date.now();
      }
    }

    // Set active immediately to prevent multiple clicks before WS confirms
    this.playbackActive.set(true);
    this.playbackLoading.set(true);

    this.influxPlaybackSub?.unsubscribe();
    this.influxPlaybackSub = null;

    if (freshStart) {
      this.liveTelemetry.subscribeToPlayback(session.sessionId);

      this.influxPlaybackSub = this.liveTelemetry.playback$.subscribe((point) => {
        if (point.type === 'start') {
          this.playbackId.set(point.playbackId);
          this.playbackSpeed = this.telemetry.speed();
          this.playbackSessionStartTs =
            Number((point as { sessionStartTs?: number }).sessionStartTs) || session.startTs;
          console.log('[playback] started:', point.playbackId);
        } else if (point.type === 'point') {
          const pt = {
            time: Number(point.time),
            signalName: String(point.signalName ?? ''),
            value: Number(point.value),
            label: String(point.label ?? ''),
          };
          const isFirstPoint = this.playbackPoints.length === 0;
          this.playbackPoints.push(pt);
          if (isFirstPoint && this.playbackPointIndex === 0) {
            this.playbackStartLogTime = pt.time;
            this.playbackStartWallTime = Date.now();
            this.playbackLoading.set(false);
            this.startChartRaf();
            this.startPlaybackClock();
          } else if (isFirstPoint && this.playbackPointIndex > 0) {
            this.playbackLoading.set(false);
          }
        } else if (point.type === 'complete') {
          this.playbackLoading.set(false);
          this.influxPlaybackSub?.unsubscribe();
          this.influxPlaybackSub = null;
          this.liveTelemetry.stopPlaybackSubscription();
          if (this.playbackPoints.length === 0) {
            this.playbackActive.set(false);
            this.playbackId.set(null);
            this.playbackComplete.set(false);
          }
        } else if (point.type === 'error') {
          this.stopPlaybackClock();
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

      this.canService
        .startPlayback({
          sessionId: session.sessionId,
          startTs: session.startTs,
          endTs: session.endTs,
          speed: this.telemetry.speed(),
        })
        .subscribe({
          next: () => {},
          error: (err) => console.error('[playback] start failed:', err),
        });
    } else {
      this.playbackLoading.set(false);
      this.startChartRaf();
      this.startPlaybackClock();
    }
  }

  stopInfluxPlayback(): void {
    const id = this.playbackId();
    if (id) {
      // Ignore 404 — server playback may have already completed
      this.canService.stopPlayback(id).subscribe({
        error: () => {}, // silent — server job already finished
      });
    }
    this.stopPlaybackClock();

    this.playbackLoading.set(false);
    this.playbackId.set(null);
    this.playbackActive.set(false);
    this.playbackComplete.set(false);
    this.influxPlaybackSub?.unsubscribe();
    this.influxPlaybackSub = null;
    this.liveTelemetry.stopPlaybackSubscription();
  }

  showAllPlaybackPoints(): void {
    const session = this.selectedSession();
    if (!session || this.playbackPoints.length === 0) return;

    this.pendingChartPoints = [];
    this.chartComponents?.toArray().forEach((chart) => chart.clear());

    const baseTs = this.playbackSessionStartTs || session.startTs;
    for (const pt of this.playbackPoints) {
      if (pt.signalName) {
        const relTime = Math.max(0, parseFloat((pt.time - baseTs).toFixed(3)));
        this.pendingChartPoints.push({
          signalName: pt.signalName,
          point: { x: relTime, y: pt.value, label: pt.label },
        });
      }
    }
    if (!this.isLiveSession()) {
      this.startChartRaf();
    }
    this.playbackComplete.set(true);
    this.playbackPointIndex = this.playbackPoints.length;
  }

  private startPlaybackClock(): void {
    this.stopPlaybackClock();

    this.playbackTimer = setInterval(() => {
      const session = this.selectedSession();
      if (!session) return;

      const baseTs = this.playbackSessionStartTs || session.startTs;

      const wallElapsed = (Date.now() - this.playbackStartWallTime) / 1000;
      const logElapsed = wallElapsed * this.playbackSpeed;
      const targetLogTime = this.playbackStartLogTime + logElapsed;

      while (
        this.playbackPointIndex < this.playbackPoints.length &&
        this.playbackPoints[this.playbackPointIndex].time <= targetLogTime
      ) {
        const pt = this.playbackPoints[this.playbackPointIndex];
        if (pt.signalName) {
          const relTime = Math.max(0, parseFloat((pt.time - baseTs).toFixed(3)));
          this.pendingChartPoints.push({
            signalName: pt.signalName,
            point: { x: relTime, y: pt.value, label: pt.label },
          });
        }
        this.playbackPointIndex++;
      }

      // Extend all active signal lines to current playback time
      const currentRelTime = Math.max(
        0,
        parseFloat((targetLogTime - (this.playbackSessionStartTs || session.startTs)).toFixed(3)),
      );
      const activeSignals = new Set(this.playbackPoints.map((p) => p.signalName));
      this.chartComponents?.toArray().forEach((chart) => {
        activeSignals.forEach((signalName) => {
          chart.extendToTime(signalName, currentRelTime);
        });
      });

      // Stop clock when all points rendered and complete event received
      if (
        this.playbackPointIndex >= this.playbackPoints.length &&
        !this.influxPlaybackSub
      ) {
        this.stopPlaybackClock();
        this.playbackActive.set(false);
        this.playbackId.set(null);
        this.playbackComplete.set(true); // all points rendered naturally
      }
    }, 16);
  }

  private stopPlaybackClock(): void {
    if (this.playbackTimer !== null) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }
}
