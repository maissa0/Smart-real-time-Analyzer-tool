import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { SnifferComponent } from '../sniffer/sniffer.component';
import { API_BASE_URL } from '../../core/config/api.config';

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

@Component({
  selector: 'app-monitor-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, HttpClientModule, SnifferComponent],
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

          <!-- Vehicle filter -->
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

          <!-- Session count badge -->
          @if (filteredSessions().length > 0) {
            <span class="kpit-badge">
              {{ filteredSessions().length }} session{{
                filteredSessions().length > 1 ? 's' : ''
              }}
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

                <!-- Status dot -->
                <span class="kpit-status-dot"
                  [class.live]="s.status === 'live'"
                  [class.done]="s.status !== 'live'">
                </span>

                <!-- Session info -->
                <div class="kpit-session-info">
                  <p class="kpit-session-id">
                    {{ s.sessionId | slice:0:8 }}…
                  </p>
                  @if (s.sourceFilename) {
                    <p class="kpit-session-file">{{ s.sourceFilename }}</p>
                  }
                  <p class="kpit-session-frames">
                    {{ (s.frameCount ?? 0).toLocaleString() }} frames
                  </p>
                </div>

                <!-- Status label -->
                <span class="kpit-status-label"
                  [class.live]="s.status === 'live'">
                  {{ s.status === 'live' ? '● Live' : '✓ Done' }}
                </span>

                <!-- Select button -->
                <button class="kpit-select-btn"
                  [class.active]="selectedSessionId() === s.sessionId">
                  {{ selectedSessionId() === s.sessionId ? '● Selected' : 'Select' }}
                </button>
              </div>
            }
          </div>
        </div>
      }

      <!-- ── Live Frame Stream (Sniffer) ────────────────────────────── -->
      <div class="kpit-section">
        <div class="kpit-section-label">
          <span class="kpit-section-dot"></span>
          LIVE FRAME STREAM
        </div>
        <app-sniffer
          [hideUpload]="true"
          [hideSimulator]="true"
          [liveOnly]="true">
        </app-sniffer>
      </div>

    </div>
  `,
  styles: [`
    .kpit-page {
      padding: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* ── Header ────────────────────────────────────────────────────── */
    .kpit-page-header {
      margin-bottom: 1.5rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid rgba(176,255,68,0.10);
    }
    .kpit-page-title-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .kpit-page-icon {
      width: 44px; height: 44px;
      background: rgba(176,255,68,0.10);
      border: 1px solid rgba(176,255,68,0.20);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: #b0ff44;
      flex-shrink: 0;
    }
    .kpit-page-icon svg { width: 20px; height: 20px; }
    .kpit-page-title {
      font-size: 1.25rem; font-weight: 700;
      color: #fff; margin: 0 0 0.2rem;
    }
    .kpit-page-subtitle {
      font-size: 0.78rem; color: #8a9ab0; margin: 0;
    }
    .kpit-live-badge {
      display: flex; align-items: center; gap: 0.4rem;
      margin-left: auto;
      background: rgba(176,255,68,0.10);
      border: 1px solid rgba(176,255,68,0.25);
      border-radius: 20px;
      padding: 4px 12px;
      font-size: 0.7rem; font-weight: 700;
      letter-spacing: 0.12em; color: #b0ff44;
    }
    .kpit-live-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #b0ff44;
      animation: kpit-pulse 1.5s ease-in-out infinite;
    }
    @keyframes kpit-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }

    /* ── Controls ──────────────────────────────────────────────────── */
    .kpit-controls-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .kpit-control-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .kpit-control-label {
      font-size: 0.75rem;
      color: #8a9ab0;
      font-weight: 500;
    }
    .kpit-select {
      background: #161b22;
      border: 1px solid rgba(176,255,68,0.20);
      border-radius: 6px;
      color: #e6edf3;
      font-size: 0.8rem;
      padding: 5px 10px;
      cursor: pointer;
      outline: none;
      transition: border-color 0.2s;
    }
    .kpit-select:focus {
      border-color: rgba(176,255,68,0.5);
    }
    .kpit-badge {
      font-size: 0.7rem;
      background: rgba(176,255,68,0.12);
      color: #b0ff44;
      border: 1px solid rgba(176,255,68,0.2);
      border-radius: 12px;
      padding: 2px 10px;
      font-weight: 600;
    }

    /* ── Section ───────────────────────────────────────────────────── */
    .kpit-section { margin-bottom: 1.5rem; }
    .kpit-section-label {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.65rem; font-weight: 700;
      letter-spacing: 0.18em; color: #b0ff44;
      margin-bottom: 0.75rem;
    }
    .kpit-section-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #b0ff44;
    }

    /* ── Session Cards ──────────────────────────────────────────────── */
    .kpit-session-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.75rem;
    }
    .kpit-session-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 0.85rem 1rem;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      transition: border-color 0.2s, box-shadow 0.2s;
      position: relative;
    }
    .kpit-session-card:hover {
      border-color: rgba(176,255,68,0.35);
    }
    .kpit-session-card.selected {
      border-color: #b0ff44;
      box-shadow: 0 0 0 2px rgba(176,255,68,0.15);
    }
    .kpit-status-dot {
      position: absolute;
      top: 0.75rem; right: 0.75rem;
      width: 8px; height: 8px;
      border-radius: 50%;
    }
    .kpit-status-dot.live {
      background: #b0ff44;
      animation: kpit-pulse 1.5s ease-in-out infinite;
    }
    .kpit-status-dot.done { background: #484f58; }
    .kpit-session-id {
      font-family: monospace;
      font-size: 0.72rem;
      color: #8a9ab0;
      margin: 0;
    }
    .kpit-session-file {
      font-size: 0.7rem;
      color: #b0ff44;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kpit-session-frames {
      font-size: 0.78rem;
      font-weight: 600;
      color: #e6edf3;
      margin: 0;
    }
    .kpit-status-label {
      font-size: 0.68rem;
      color: #484f58;
      font-weight: 500;
    }
    .kpit-status-label.live { color: #b0ff44; }
    .kpit-select-btn {
      margin-top: 0.25rem;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.7rem;
      font-weight: 600;
      border: 1px solid #30363d;
      background: transparent;
      color: #8a9ab0;
      cursor: pointer;
      transition: all 0.2s;
      align-self: flex-start;
    }
    .kpit-select-btn:hover {
      border-color: rgba(176,255,68,0.4);
      color: #b0ff44;
    }
    .kpit-select-btn.active {
      background: rgba(176,255,68,0.12);
      border-color: #b0ff44;
      color: #b0ff44;
    }
  `],
})
export class MonitorPageComponent implements OnInit {
  private readonly http    = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly cars             = signal<Car[]>([]);
  readonly allSessions      = signal<Session[]>([]);
  readonly filteredSessions = signal<Session[]>([]);
  readonly selectedSessionId = signal<string | null>(null);
  readonly selectedCarUid   = signal<string>('');

  ngOnInit(): void {
    this.loadCars();
    this.loadSessions('');
  }

  onVehicleChange(event: Event): void {
    const carUid = (event.target as HTMLSelectElement).value;
    this.selectedCarUid.set(carUid);
    this.loadSessions(carUid);
  }

  selectSession(sessionId: string): void {
    this.selectedSessionId.set(
      this.selectedSessionId() === sessionId ? null : sessionId
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
          this.allSessions.set(sessions);
          this.filteredSessions.set(sessions);
        },
        error: (err) => console.error('[MonitorPage] sessions error:', err),
      });
  }
}
