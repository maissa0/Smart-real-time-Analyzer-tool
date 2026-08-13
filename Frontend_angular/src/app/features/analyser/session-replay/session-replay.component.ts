import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CanService } from '../../../core/services/can.service';
import { ReplayEngineService } from '../../../core/services/replay-engine.service';
import { SessionSummaryService, KeyEvent } from '../../../core/services/session-summary.service';
import { LiveTelemetryService } from '../../../core/services/live-telemetry.service';
import { CanSession } from '../../../core/models/can.model';
import { ReplayBarComponent } from '../../sniffer/replay-bar/replay-bar.component';
import { SignalChartComponent, ChartDataset } from '../../sniffer/signal-chart/signal-chart.component';

interface Bookmark {
  time: number;
  label: string;
}

@Component({
  selector: 'app-session-replay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReplayBarComponent, SignalChartComponent],
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; background: #07090b; overflow: hidden; }

    .breadcrumb {
      display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 1.25rem;
      background: #0d1117; border-bottom: 1px solid rgba(176,255,68,0.08);
      flex-shrink: 0; font-size: 0.75rem;
    }
    .breadcrumb-back {
      color: #b0ff44; cursor: pointer; background: none; border: none;
      font-size: 0.75rem; padding: 0; transition: opacity 0.15s;
    }
    .breadcrumb-back:hover { opacity: 0.75; }
    .breadcrumb-sep { color: #484f58; }
    .breadcrumb-label { color: #8a9ab0; }
    .replay-badge {
      padding: 2px 7px; border-radius: 4px; font-size: 0.62rem; font-weight: 700;
      letter-spacing: 0.05em; background: rgba(176,255,68,0.12); color: #b0ff44;
    }
    .breadcrumb-meta { margin-left: auto; font-size: 0.68rem; color: #484f58; }
    .playing-dot { color: #b0ff44; animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }

    .meta-bar {
      display: flex; align-items: center; gap: 1.5rem; padding: 0.45rem 1.25rem;
      background: #0d1117; border-bottom: 1px solid rgba(176,255,68,0.06);
      flex-shrink: 0; flex-wrap: wrap;
    }
    .meta-item { font-size: 0.7rem; color: #8a9ab0; }
    .meta-item strong { color: #e6edf3; font-weight: 600; }

    .replay-body { flex: 1; overflow: hidden; display: flex; flex-direction: row; }

    /* Charts pane */
    .charts-pane {
      flex: 1; overflow-y: auto; display: flex; flex-direction: column; min-width: 0;
    }

    /* Signal selector bar */
    .signal-bar {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;
      background: #0d1117; border-bottom: 1px solid rgba(176,255,68,0.06);
      flex-shrink: 0; flex-wrap: wrap;
    }
    .signal-bar-label { font-size: 0.65rem; color: #484f58; text-transform: uppercase; letter-spacing: 0.06em; }
    .signal-chip {
      padding: 3px 9px; border-radius: 5px; font-size: 0.68rem; font-weight: 600;
      border: 1px solid #30363d; background: transparent; color: #8a9ab0; cursor: pointer;
      transition: all 0.15s;
    }
    .signal-chip:hover { border-color: rgba(176,255,68,0.3); color: #b0ff44; }
    .signal-chip.active { border-color: rgba(176,255,68,0.4); background: rgba(176,255,68,0.08); color: #b0ff44; }
    .signal-chip.remove { border-color: rgba(255,68,68,0.2); color: #ff6b6b; }
    .signal-chip.remove:hover { border-color: #ff4444; }

    /* Charts area */
    .charts-area { flex: 1; padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .chart-empty {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 200px; gap: 0.75rem; color: #484f58; font-size: 0.78rem;
      border: 1px dashed #21262d; border-radius: 8px; margin: 0.75rem 1rem;
    }
    .chart-empty h3 { color: #8a9ab0; font-size: 0.9rem; margin: 0; }
    .chart-empty p { margin: 0; }

    /* Bookmarks pane */
    .bookmarks-pane {
      width: 240px; flex-shrink: 0; background: #0d1117;
      border-left: 1px solid rgba(176,255,68,0.08); overflow-y: auto;
      display: flex; flex-direction: column;
    }
    .bookmarks-header {
      padding: 0.65rem 1rem; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.07em;
      color: #b0ff44; text-transform: uppercase; border-bottom: 1px solid rgba(176,255,68,0.06);
      flex-shrink: 0;
    }
    .bookmark-empty { padding: 1.25rem 1rem; font-size: 0.72rem; color: #484f58; text-align: center; line-height: 1.6; }
    .bookmark-item {
      padding: 0.55rem 1rem; border-bottom: 1px solid rgba(176,255,68,0.04);
      cursor: pointer; transition: background 0.1s;
    }
    .bookmark-item:hover { background: rgba(176,255,68,0.04); }
    .bookmark-time { font-size: 0.65rem; color: #b0ff44; font-weight: 700; font-family: monospace; }
    .bookmark-label { font-size: 0.7rem; color: #8a9ab0; margin-top: 2px; line-height: 1.4; }

    .spinner {
      width: 16px; height: 16px; border: 2px solid #21262d; border-top-color: #b0ff44;
      border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
  template: `
    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <button class="breadcrumb-back" (click)="goBack()">← Sessions</button>
      <span class="breadcrumb-sep">/</span>
      <button class="breadcrumb-back" (click)="goInspector()">{{ displayName() }}</button>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-label">Replay</span>
      <span class="replay-badge">REPLAY</span>
      <span class="breadcrumb-meta">
        @if (replay.state() === 'playing') {
          <span class="playing-dot">●</span> PLAYING {{ replay.speed() }}×
        } @else if (replay.state() === 'paused') {
          PAUSED
        }
      </span>
    </div>

    <!-- Metadata bar -->
    <div class="meta-bar">
      @if (session(); as s) {
        <span class="meta-item"><strong>{{ s.frameCount | number }}</strong> frames</span>
<span class="meta-item">{{ s.createdAt | date:'d MMM yyyy' }}</span>
      }
      <span class="meta-item" style="margin-left:auto;">
        {{ formatTime(replay.currentTime()) }} / {{ formatTime(replay.totalTime()) }}
      </span>
    </div>

    <!-- Replay controls -->
    <app-replay-bar
      (playRequested)="replay.play()"
      (stopRequested)="onStopReplay()"
    />

    <!-- Body -->
    <div class="replay-body">
      <!-- Charts pane -->
      <div class="charts-pane">
        <!-- Signal selector -->
        <div class="signal-bar">
          <span class="signal-bar-label">Signals</span>
          @for (name of availableSignals(); track name) {
            <button class="signal-chip"
                    [class.active]="selectedSignals().has(name)"
                    (click)="toggleSignal(name)">
              {{ name }}
            </button>
          }
            @if (loadingData()) {
            <span class="spinner"></span>
            <span style="font-size:0.7rem; color:#484f58;">Loading signal data…</span>
          }
          @if (!loadingData() && availableSignals().length === 0) {
            <span style="font-size:0.7rem; color:#484f58;">No signals found</span>
          }
        </div>

        <!-- Charts area -->
        <div class="charts-area">
          @if (selectedSignals().size === 0) {
            <div class="chart-empty">
              <h3>No signals selected</h3>
              <p>Select one or more signals above to view replay charts.</p>
            </div>
          } @else {
            @for (name of selectedSignalsArray(); track name) {
              <app-signal-chart
                [msgName]="name"
                [groupTitle]="name"
                [datasets]="datasetsForSignal(name)"
                [playheadTime]="replay.currentTime()"
              />
            }
          }
        </div>
      </div>

      <!-- Bookmarks pane -->
      <div class="bookmarks-pane">
        <div class="bookmarks-header">Bookmarks</div>
        @if (bookmarks().length === 0) {
          <div class="bookmark-empty">
            No AI bookmarks.<br>Generate a report to create bookmarks.
          </div>
        } @else {
          @for (bm of bookmarks(); track bm.time) {
            <div class="bookmark-item" (click)="seekTo(bm.time)">
              <div class="bookmark-time">{{ formatTime(bm.time) }}</div>
              <div class="bookmark-label">{{ bm.label }}</div>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class SessionReplayComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private canService = inject(CanService);
  private summaryService = inject(SessionSummaryService);
  private liveTelemetry = inject(LiveTelemetryService);
  private destroyRef = inject(DestroyRef);

  readonly replay = inject(ReplayEngineService);

  sessionId = signal('');
  returnUrl = signal('/admin/workspace');
  session = signal<CanSession | null>(null);
  bookmarks = signal<Bookmark[]>([]);
  availableSignals = signal<string[]>([]);
  selectedSignals = signal<Set<string>>(new Set());
  loadingData = signal(false);

  displayName = computed(() => {
    const s = this.session();
    return s?.sourceFilename || this.sessionId();
  });

  selectedSignalsArray = computed(() => Array.from(this.selectedSignals()));

  chartDatasets = signal<Map<string, ChartDataset>>(new Map());

  private sessionStartTs = 0;
  private allRawPoints = new Map<string, { time: number; value: number; label: string }[]>();

  private readonly CHART_COLORS = [
    '#b0ff44', '#58a6ff', '#f78166', '#ffa657', '#bc8cff', '#39d353', '#ff7b72',
  ];

  ngOnInit(): void {
    this.replay.reset();

    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl) this.returnUrl.set(returnUrl);

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('sessionId') ?? '';
        this.sessionId.set(id);
        if (id) this.loadAll(id);
      });

    this.replay.onTick((_t) => {});
  }

  ngOnDestroy(): void {
    this.liveTelemetry.stopPlaybackSubscription();
    this.replay.stop();
    this.replay.reset();
  }

  private loadAll(id: string): void {
    this.canService
      .getSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sessions) => {
        const found = sessions.find((s) => s.sessionId === id) ?? null;
        this.session.set(found);
        if (found) this.startPlaybackLoad(found);
      });

    this.summaryService
      .getQuiet(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => this.bookmarks.set(this.keyEventsToBookmarks(summary.keyEvents ?? [])),
        error: () => this.bookmarks.set([]),
      });
  }

  private startPlaybackLoad(session: CanSession): void {
    this.allRawPoints.clear();
    this.chartDatasets.set(new Map());
    this.selectedSignals.set(new Set());
    this.availableSignals.set([]);
    this.loadingData.set(true);

    this.liveTelemetry.subscribeToPlayback(session.sessionId);

    this.liveTelemetry.playback$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.type === 'start') {
          this.sessionStartTs = (event as any).sessionStartTs ?? session.startTs ?? 0;
        } else if (event.type === 'point') {
          const name = (event as any).signalName ?? 'N/A';
          if (name === 'N/A') return;
          if (!this.allRawPoints.has(name)) this.allRawPoints.set(name, []);
          this.allRawPoints.get(name)!.push({
            time: (event as any).time,
            value: (event as any).value ?? 0,
            label: (event as any).label ?? String((event as any).value ?? 0),
          });
        } else if (event.type === 'complete' || event.type === 'error') {
          this.buildDatasetsFromRaw();
          this.loadingData.set(false);
          this.liveTelemetry.stopPlaybackSubscription();
        }
      });

    // Start the stream only once the STOMP subscription is live — events
    // published before it are dropped and the charts never finish loading.
    this.liveTelemetry.awaitConnected().then(() => this.canService
      .startPlayback({ sessionId: session.sessionId, startTs: session.startTs, endTs: session.endTs, speed: 1 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadingData.set(false) }));
  }

  private buildDatasetsFromRaw(): void {
    // Use the earliest actual InfluxDB point as the x-axis origin — matching the
    // sniffer's loadAndDisplayAllFromInflux() baseTs approach. Using sessionStartTs
    // here caused filter(p.x >= 0) to discard points in [floor(startTs), startTs)
    // that InfluxDB returned due to Java's (long) truncation of the float startTs.
    let globalMinTime = Infinity;
    for (const pts of this.allRawPoints.values()) {
      if (pts.length > 0 && pts[0].time < globalMinTime) globalMinTime = pts[0].time;
    }
    const origin = isFinite(globalMinTime) ? globalMinTime : this.sessionStartTs;
    const datasets = new Map<string, ChartDataset>();
    const signalNames = Array.from(this.allRawPoints.keys()).sort();
    let maxDuration = 0;

    signalNames.forEach((name, colorIndex) => {
      const raw = this.allRawPoints.get(name)!;
      const color = this.CHART_COLORS[colorIndex % this.CHART_COLORS.length];
      const points = raw
        .map((p) => ({ x: p.time - origin, y: parseFloat(String(p.value)) || 0, label: p.label || String(p.value) }))
        .filter((p) => p.x >= 0)
        .sort((a, b) => a.x - b.x);
      const maxX = points.reduce((m, p) => Math.max(m, p.x), 0);
      if (maxX > maxDuration) maxDuration = maxX;
      datasets.set(name, { signalName: name, color, points });
    });

    if (maxDuration > this.replay.totalTime()) {
      this.replay.setDuration(Math.ceil(maxDuration));
    }
    // Clamp any bookmarks that were loaded before data arrived and exceed the actual duration
    if (maxDuration > 0) {
      this.bookmarks.update(bks => bks.filter(b => b.time <= maxDuration));
    }
    this.availableSignals.set(signalNames);
    this.chartDatasets.set(datasets);
  }

  private keyEventsToBookmarks(keyEvents: KeyEvent[]): Bookmark[] {
    const maxTime = this.replay.totalTime();
    return keyEvents
      .map(ev => ({ time: this.parseKeyEventTime(ev.time), label: ev.description }))
      .filter(b => b.time >= 0 && (maxTime <= 0 || b.time <= maxTime));
  }

  private parseKeyEventTime(timeStr: string): number {
    const cleaned = (timeStr ?? '').replace(/^\+/, '').trim();
    const parts = cleaned.split(':');
    if (parts.length === 2) {
      const m = parseInt(parts[0], 10);
      const s = parseFloat(parts[1]);
      if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
    } else if (parts.length === 1) {
      const s = parseFloat(parts[0]);
      if (!isNaN(s)) return s;
    }
    return -1;
  }

  toggleSignal(name: string): void {
    this.selectedSignals.update((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  datasetsForSignal(name: string): ChartDataset[] {
    const ds = this.chartDatasets().get(name);
    return ds ? [ds] : [];
  }

  onStopReplay(): void {
    this.replay.stop();
    this.replay.reset();
  }

  seekTo(time: number): void {
    this.replay.seek(time);
  }

  formatTime(sec: number): string {
    if (!sec || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  goBack(): void {
    this.router.navigateByUrl(this.returnUrl());
  }

  goInspector(): void {
    this.router.navigate(['/admin/workspace/session', this.sessionId()], {
      queryParams: { returnUrl: this.returnUrl() },
    });
  }
}
