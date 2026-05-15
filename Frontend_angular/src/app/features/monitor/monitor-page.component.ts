import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { SnifferComponent } from '../sniffer/sniffer.component';
import { LiveTelemetryService } from '../../core/services/live-telemetry.service';
import { API_BASE_URL } from '../../core/config/api.config';
import { CanFrame } from '../../data/models/can.model';

interface Car {
  carUid: string;
  make: string;
  model: string;
  year: number;
  isVirtual: boolean;
}

interface Session {
  id: number;
  sessionId: string;
  sourceFilename: string | null;
  frameCount: number | null;
  createdAt: string | null;
  status?: string;
}

/** Max frames kept in the live table to avoid memory growth */
const MAX_FRAMES = 500;

@Component({
  selector: 'app-monitor-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, HttpClientModule, SnifferComponent],
  styleUrls: ['./monitor-page.component.scss'],
  template: `
    <div class="kpit-page">

      <!-- ── Page Header ──────────────────────────────────────────────── -->
      <div class="kpit-page-header">
        <div class="kpit-page-title-row">
          <div class="kpit-page-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div>
            <h1 class="kpit-page-title">Live Monitor</h1>
            <p class="kpit-page-subtitle">
              Real-time CAN bus monitoring from active simulator or hardware
            </p>
          </div>
          <div class="kpit-live-badge">
            <span class="kpit-live-dot"></span>
            LIVE
          </div>
        </div>

        <!-- ── Controls row ───────────────────────────────────────────── -->
        <div class="kpit-controls-row">
          <div class="kpit-control-group">
            <label class="kpit-control-label">Vehicle</label>
            <select class="kpit-select" (change)="onVehicleChange($event)">
              <option value="">All Vehicles</option>
              @for (car of cars(); track car.carUid) {
                <option [value]="car.carUid">
                  {{ car.make }} {{ car.model }} {{ car.year }}
                  {{ car.isVirtual ? '(virtual)' : '' }}
                </option>
              }
            </select>
          </div>
          @if (filteredSessions().length > 0) {
            <span class="kpit-badge">
              {{ filteredSessions().length }}
              session{{ filteredSessions().length > 1 ? 's' : '' }}
            </span>
          }
        </div>
      </div>

      <!-- ── Session Cards ──────────────────────────────────────────── -->
      @if (filteredSessions().length > 0) {
        <div class="kpit-section">
          <div class="kpit-section-label">
            <span class="kpit-section-dot"></span>
            SESSIONS
          </div>
          <div class="kpit-session-grid">
            @for (s of filteredSessions(); track s.sessionId) {
              <div
                class="kpit-session-card"
                [class.selected]="selectedSessionId() === s.sessionId"
                (click)="selectSession(s.sessionId)">
                <span class="kpit-status-dot"
                  [class.live]="s.status === 'live'"
                  [class.done]="s.status !== 'live'">
                </span>
                <div class="kpit-session-info">
                  <p class="kpit-session-id">{{ s.sessionId | slice:0:8 }}…</p>
                  @if (s.sourceFilename) {
                    <p class="kpit-session-file">{{ s.sourceFilename }}</p>
                  }
                  <p class="kpit-session-frames">
                    {{ (s.frameCount ?? 0).toLocaleString() }} frames
                  </p>
                </div>
                <span class="kpit-status-label" [class.live]="s.status === 'live'">
                  {{ s.status === 'live' ? '● Live' : '✓ Done' }}
                </span>
                <button class="kpit-select-btn"
                  [class.active]="selectedSessionId() === s.sessionId">
                  {{ selectedSessionId() === s.sessionId ? '● Selected' : 'Select' }}
                </button>
              </div>
            }
          </div>
        </div>
      }

      <!-- ── Live Frame Stream ───────────────────────────────────────── -->
      <div class="kpit-section">
        <div class="kpit-section-label">
          <span class="kpit-section-dot"></span>
          LIVE FRAME STREAM
          <span class="kpit-frame-count">{{ liveFrames().length }} frames</span>
        </div>

        <!-- Frame stream controls -->
        <div class="kpit-stream-controls">
          <!-- Msg ID filter -->
          <div class="kpit-control-group">
            <label class="kpit-control-label">Filter</label>
            <select class="kpit-select" (change)="onMsgIdFilter($event)">
              <option value="">All IDs</option>
              @for (id of seenMsgIds(); track id) {
                <option [value]="id">{{ id }}</option>
              }
            </select>
          </div>

          <!-- Pause toggle -->
          <button
            class="kpit-stream-btn"
            [class.paused]="isPaused()"
            (click)="togglePause()">
            {{ isPaused() ? '▶ Resume' : '⏸ Pause' }}
            @if (isPaused() && bufferedFrames().length > 0) {
              <span class="kpit-buffer-badge">
                +{{ bufferedFrames().length }}
              </span>
            }
          </button>

          <!-- Auto-scroll toggle -->
          <label class="kpit-checkbox-label">
            <input type="checkbox"
              [checked]="autoScroll()"
              (change)="toggleAutoScroll()">
            Auto-scroll
          </label>

          <!-- Clear button -->
          <button class="kpit-stream-btn" (click)="clearFrames()">
            ✕ Clear
          </button>
        </div>

        <!-- Frame table -->
        <div class="kpit-frame-table-wrap" #frameTableWrap>
          <table class="kpit-frame-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Msg ID</th>
                <th>Name</th>
                <th>Dir</th>
                <th>Raw Bytes</th>
              </tr>
            </thead>
            <tbody>
              @for (f of displayedFrames(); track f.id) {
                <tr [class.live-row]="f._isNew">
                  <td class="mono">{{ f.timestamp?.toFixed(3) ?? '—' }}</td>
                  <td class="mono accent">{{ f.msgId ?? '—' }}</td>
                  <td class="mono muted">{{ f.msgName ?? '—' }}</td>
                  <td class="mono">{{ f.direction ?? '—' }}</td>
                  <td class="mono muted small">
                    {{ truncate(f.rawBytes) }}
                  </td>
                </tr>
              }
              @if (displayedFrames().length === 0) {
                <tr>
                  <td colspan="5" class="empty-row">
                    @if (liveTelemetry.connected()) {
                      Waiting for frames… Start the simulator to see live data.
                    } @else {
                      WebSocket disconnected — start the backend and simulator.
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── Signal Charts (Sniffer) ────────────────────────────────── -->
      <div class="kpit-section">
        <div class="kpit-section-label">
          <span class="kpit-section-dot"></span>
          SIGNAL CHARTS
        </div>
        <div
          class="kpit-monitor-signal-charts"
          [class.kpit-monitor-signal-charts--pulse]="signalChartsPulse()">
          <app-sniffer
            [hideUpload]="true"
            [hideSimulator]="true"
            [liveOnly]="true"
            [kpitMonitorChartTheme]="true">
          </app-sniffer>
        </div>
      </div>

    </div>
  `,
  styles: [`
    .kpit-page { padding: 1.5rem; max-width: 1400px; margin: 0 auto; }

    .kpit-page-header {
      margin-bottom: 1.5rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid rgba(176,255,68,0.10);
    }
    .kpit-page-title-row {
      display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;
    }
    .kpit-page-icon {
      width: 44px; height: 44px;
      background: rgba(176,255,68,0.10);
      border: 1px solid rgba(176,255,68,0.20);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: #b0ff44; flex-shrink: 0;
    }
    .kpit-page-icon svg { width: 20px; height: 20px; }
    .kpit-page-title {
      font-size: 1.25rem; font-weight: 700; color: #fff; margin: 0 0 0.2rem;
    }
    .kpit-page-subtitle { font-size: 0.78rem; color: #8a9ab0; margin: 0; }
    .kpit-live-badge {
      display: flex; align-items: center; gap: 0.4rem; margin-left: auto;
      background: rgba(176,255,68,0.10);
      border: 1px solid rgba(176,255,68,0.25);
      border-radius: 20px; padding: 4px 12px;
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.12em; color: #b0ff44;
    }
    .kpit-live-dot {
      width: 7px; height: 7px; border-radius: 50%; background: #b0ff44;
      animation: kpit-pulse 1.5s ease-in-out infinite;
    }
    @keyframes kpit-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

    .kpit-controls-row {
      display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
    }
    .kpit-control-group { display: flex; align-items: center; gap: 0.5rem; }
    .kpit-control-label { font-size: 0.75rem; color: #8a9ab0; font-weight: 500; }
    .kpit-select {
      background: #161b22; border: 1px solid rgba(176,255,68,0.20);
      border-radius: 6px; color: #e6edf3; font-size: 0.8rem;
      padding: 5px 10px; cursor: pointer; outline: none;
    }
    .kpit-select:focus { border-color: rgba(176,255,68,0.5); }
    .kpit-badge {
      font-size: 0.7rem; background: rgba(176,255,68,0.12); color: #b0ff44;
      border: 1px solid rgba(176,255,68,0.2); border-radius: 12px;
      padding: 2px 10px; font-weight: 600;
    }

    .kpit-section { margin-bottom: 1.5rem; }
    .kpit-section-label {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.18em;
      color: #b0ff44; margin-bottom: 0.75rem;
    }
    .kpit-section-dot {
      width: 6px; height: 6px; border-radius: 50%; background: #b0ff44;
    }
    .kpit-frame-count {
      margin-left: auto; font-size: 0.65rem; color: #484f58; font-weight: 400;
    }

    /* Session cards */
    .kpit-session-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr));
      gap: 0.75rem;
    }
    .kpit-session-card {
      background: #161b22; border: 1px solid #30363d; border-radius: 10px;
      padding: 0.85rem 1rem; cursor: pointer;
      display: flex; flex-direction: column; gap: 0.4rem;
      transition: border-color 0.2s; position: relative;
    }
    .kpit-session-card:hover { border-color: rgba(176,255,68,0.35); }
    .kpit-session-card.selected {
      border-color: #b0ff44;
      box-shadow: 0 0 0 2px rgba(176,255,68,0.15);
    }
    .kpit-status-dot {
      position: absolute; top: 0.75rem; right: 0.75rem;
      width: 8px; height: 8px; border-radius: 50%;
    }
    .kpit-status-dot.live {
      background: #b0ff44; animation: kpit-pulse 1.5s ease-in-out infinite;
    }
    .kpit-status-dot.done { background: #484f58; }
    .kpit-session-id { font-family: monospace; font-size: 0.72rem; color: #8a9ab0; margin: 0; }
    .kpit-session-file { font-size: 0.7rem; color: #b0ff44; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kpit-session-frames { font-size: 0.78rem; font-weight: 600; color: #e6edf3; margin: 0; }
    .kpit-status-label { font-size: 0.68rem; color: #484f58; font-weight: 500; }
    .kpit-status-label.live { color: #b0ff44; }
    .kpit-select-btn {
      margin-top: 0.25rem; padding: 4px 10px; border-radius: 6px;
      font-size: 0.7rem; font-weight: 600; border: 1px solid #30363d;
      background: transparent; color: #8a9ab0; cursor: pointer;
      transition: all 0.2s; align-self: flex-start;
    }
    .kpit-select-btn:hover { border-color: rgba(176,255,68,0.4); color: #b0ff44; }
    .kpit-select-btn.active {
      background: rgba(176,255,68,0.12); border-color: #b0ff44; color: #b0ff44;
    }

    /* Frame stream */
    .kpit-stream-controls {
      display: flex; align-items: center; gap: 0.75rem;
      flex-wrap: wrap; margin-bottom: 0.75rem;
    }
    .kpit-stream-btn {
      padding: 5px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;
      border: 1px solid #30363d; background: #161b22; color: #8a9ab0;
      cursor: pointer; transition: all 0.2s; position: relative;
    }
    .kpit-stream-btn:hover { border-color: rgba(176,255,68,0.4); color: #b0ff44; }
    .kpit-stream-btn.paused {
      border-color: #b0ff44; color: #b0ff44; background: rgba(176,255,68,0.08);
    }
    .kpit-buffer-badge {
      display: inline-block; margin-left: 6px;
      background: #b0ff44; color: #0d1117;
      font-size: 0.6rem; font-weight: 700;
      border-radius: 8px; padding: 1px 5px;
    }
    .kpit-checkbox-label {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.75rem; color: #8a9ab0; cursor: pointer;
    }
    .kpit-checkbox-label input { accent-color: #b0ff44; cursor: pointer; }

    .kpit-frame-table-wrap {
      background: #0d1117; border: 1px solid #21262d; border-radius: 8px;
      max-height: 320px; overflow-y: auto;
    }
    .kpit-frame-table {
      width: 100%; border-collapse: collapse; font-size: 0.75rem;
    }
    .kpit-frame-table thead th {
      background: #161b22; color: #8a9ab0; font-weight: 600;
      padding: 6px 10px; text-align: left; border-bottom: 1px solid #21262d;
      position: sticky; top: 0; z-index: 1;
    }
    .kpit-frame-table tbody tr {
      border-bottom: 1px solid #161b22; transition: background 0.15s;
    }
    .kpit-frame-table tbody tr:hover { background: #161b22; }
    .kpit-frame-table tbody tr.live-row { animation: row-flash 0.4s ease-out; }
    @keyframes row-flash {
      0% { background: rgba(176,255,68,0.15); }
      100% { background: transparent; }
    }
    .kpit-frame-table td { padding: 5px 10px; color: #e6edf3; }
    .mono { font-family: monospace; }
    .accent { color: #b0ff44; }
    .muted { color: #8a9ab0; }
    .small { font-size: 0.68rem; }
    .empty-row { text-align: center; color: #484f58; padding: 2rem !important; }
  `],
})
export class MonitorPageComponent implements OnInit {
  private readonly http       = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly liveTelemetry      = inject(LiveTelemetryService);

  @ViewChild('frameTableWrap') frameTableWrap!: ElementRef<HTMLDivElement>;

  // ── Vehicle / session state ───────────────────────────────────────────────
  readonly cars             = signal<Car[]>([]);
  readonly allSessions      = signal<Session[]>([]);
  readonly filteredSessions = signal<Session[]>([]);
  readonly selectedSessionId = signal<string | null>(null);
  readonly selectedCarUid   = signal<string>('');

  // ── Live frame stream state ───────────────────────────────────────────────
  readonly liveFrames    = signal<(CanFrame & { _isNew?: boolean })[]>([]);
  readonly bufferedFrames = signal<CanFrame[]>([]);
  readonly isPaused      = signal(false);
  readonly autoScroll    = signal(true);
  readonly msgIdFilter   = signal('');
  readonly seenMsgIds    = signal<string[]>([]);

  readonly displayedFrames = signal<(CanFrame & { _isNew?: boolean })[]>([]);

  /** Toggles CSS flash on embedded signal chart cards when new live frames arrive */
  readonly signalChartsPulse = signal(false);
  private signalChartsPulseTimer: ReturnType<typeof setTimeout> | null = null;
  private signalChartsPulseCooldownUntil = 0;

  ngOnInit(): void {
    this.loadCars();
    this.loadSessions('');
    this.subscribeToFrames();
  }

  // ── Vehicle / session methods ─────────────────────────────────────────────

  onVehicleChange(event: Event): void {
    const carUid = (event.target as HTMLSelectElement).value;
    this.selectedCarUid.set(carUid);
    this.loadSessions(carUid);
    // Clear selected session when vehicle changes
    this.selectedSessionId.set(null);
  }

  selectSession(sessionId: string): void {
    this.selectedSessionId.set(
      this.selectedSessionId() === sessionId ? null : sessionId
    );
  }

  // ── Frame stream methods ──────────────────────────────────────────────────

  togglePause(): void {
    if (this.isPaused()) {
      // Resume — flush buffer into live frames
      const buffered = this.bufferedFrames();
      if (buffered.length > 0) {
        this.appendFrames(buffered);
        this.bufferedFrames.set([]);
        this.scheduleSignalChartsBorderPulse();
      }
      this.isPaused.set(false);
    } else {
      this.isPaused.set(true);
    }
  }

  toggleAutoScroll(): void {
    this.autoScroll.set(!this.autoScroll());
  }

  onMsgIdFilter(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.msgIdFilter.set(val);
    this.updateDisplayed();
  }

  clearFrames(): void {
    this.liveFrames.set([]);
    this.bufferedFrames.set([]);
    this.displayedFrames.set([]);
  }

  truncate(raw: string | null | undefined): string {
    if (!raw) return '—';
    return raw.length > 30 ? raw.substring(0, 30) + '…' : raw;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private subscribeToFrames(): void {
    this.liveTelemetry.frames$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((frame) => {
        // Track seen message IDs for filter dropdown
        if (frame.msgId && !this.seenMsgIds().includes(frame.msgId)) {
          this.seenMsgIds.update(ids => [...ids, frame.msgId!].sort());
        }

        if (this.isPaused()) {
          // Buffer frames while paused — cap buffer at 200
          this.bufferedFrames.update(buf => {
            const next = [...buf, frame];
            return next.length > 200 ? next.slice(-200) : next;
          });
        } else {
          this.appendFrames([frame]);
          this.scheduleSignalChartsBorderPulse();
        }
      });
  }

  private scheduleSignalChartsBorderPulse(): void {
    const now = Date.now();
    if (now < this.signalChartsPulseCooldownUntil) {
      return;
    }
    this.signalChartsPulseCooldownUntil = now + 280;

    if (this.signalChartsPulseTimer !== null) {
      clearTimeout(this.signalChartsPulseTimer);
      this.signalChartsPulseTimer = null;
    }

    this.signalChartsPulse.set(false);
    requestAnimationFrame(() => {
      this.signalChartsPulse.set(true);
      this.signalChartsPulseTimer = setTimeout(() => {
        this.signalChartsPulse.set(false);
        this.signalChartsPulseTimer = null;
      }, 420);
    });
  }

  private appendFrames(frames: CanFrame[]): void {
    const tagged = frames.map(f => ({ ...f, _isNew: true }));
    this.liveFrames.update(existing => {
      const next = [...existing, ...tagged];
      // Cap at MAX_FRAMES to prevent memory growth
      return next.length > MAX_FRAMES ? next.slice(-MAX_FRAMES) : next;
    });
    this.updateDisplayed();

    // Auto-scroll to bottom
    if (this.autoScroll() && this.frameTableWrap?.nativeElement) {
      setTimeout(() => {
        const el = this.frameTableWrap.nativeElement;
        el.scrollTop = el.scrollHeight;
      }, 0);
    }
  }

  private updateDisplayed(): void {
    const filter = this.msgIdFilter();
    const all = this.liveFrames();
    this.displayedFrames.set(
      filter ? all.filter(f => f.msgId === filter) : all
    );
  }

  private headers(): HttpHeaders {
    const token = localStorage.getItem('access_token');
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  private loadCars(): void {
    this.http
      .get<Car[]>(`${API_BASE_URL}/api/cars`, { headers: this.headers() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cars) => this.cars.set(cars),
        error: (err) => console.error('[MonitorPage] cars error:', err),
      });
  }

  private loadSessions(carUid: string): void {
    const url = carUid
      ? `${API_BASE_URL}/api/cars/${carUid}/sessions`
      : `${API_BASE_URL}/api/can/sessions`;
    this.http
      .get<Session[]>(url, { headers: this.headers() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sessions) => {
          // Sort: live sessions first, then by createdAt descending
          const sorted = [...sessions].sort((a, b) => {
            if (a.status === 'live' && b.status !== 'live') return -1;
            if (a.status !== 'live' && b.status === 'live') return 1;
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
          });
          this.allSessions.set(sorted);
          this.filteredSessions.set(sorted);
        },
        error: (err) => console.error('[MonitorPage] sessions error:', err),
      });
  }
}
