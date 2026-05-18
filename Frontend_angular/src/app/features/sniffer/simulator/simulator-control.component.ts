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
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Output, EventEmitter } from '@angular/core';
import { interval } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { SimulatorStateService } from '../../../core/services/simulator-state.service';

interface Car {
  carUid: string;
  make: string;
  model: string;
  year: number;
  isVirtual: boolean;
}

interface SimStatus {
  simulators: Array<{
    simId: string;
    running: boolean;
    pid: number | null;
    startedAt: string | null;
    mode: string | null;
  }>;
  count: number;
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  mode: string | null;
  simId: string | null;
}

@Component({
  selector: 'app-simulator-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  styles: [`
    .sc-wrap { display: flex; flex-direction: column; gap: 1rem; }

    /* Section label */
    .sc-section { display: flex; flex-direction: column; gap: 0.5rem; }
    .sc-label {
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.18em;
      color: #b0ff44; text-transform: uppercase;
    }

    /* Select / input base */
    .sc-select, .sc-input {
      width: 100%;
      background: #161b22;
      border: 1px solid rgba(176,255,68,0.20);
      border-radius: 6px;
      color: #e6edf3;
      font-size: 0.8rem;
      padding: 6px 10px;
      outline: none;
      transition: border-color 0.2s;
    }
    .sc-select:focus, .sc-input:focus {
      border-color: rgba(176,255,68,0.5);
    }

    /* Mode radio buttons */
    .sc-mode-row { display: flex; gap: 0.5rem; }
    .sc-mode-btn {
      flex: 1; padding: 6px; border-radius: 6px; font-size: 0.75rem;
      font-weight: 600; border: 1px solid #30363d;
      background: transparent; color: #8a9ab0; cursor: pointer;
      transition: all 0.2s; text-align: center;
    }
    .sc-mode-btn.active {
      border-color: #b0ff44; color: #b0ff44;
      background: rgba(176,255,68,0.08);
    }

    /* Slider */
    .sc-slider-row { display: flex; align-items: center; gap: 0.75rem; }
    .sc-slider {
      flex: 1; accent-color: #b0ff44; cursor: pointer;
    }
    .sc-slider-val {
      font-size: 0.78rem; font-weight: 700; color: #b0ff44;
      min-width: 48px; text-align: right;
    }

    /* Checkboxes */
    .sc-checks { display: flex; flex-direction: column; gap: 0.4rem; }
    .sc-check-label {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.78rem; color: #c9d1d9; cursor: pointer;
    }
    .sc-check-label input[type="checkbox"] { accent-color: #ffaa00; }

    /* START button */
    .sc-start-btn {
      width: 100%; padding: 12px;
      background: #b0ff44; color: #07090b;
      font-size: 0.9rem; font-weight: 700;
      border: none; border-radius: 8px;
      cursor: pointer; transition: opacity 0.2s;
      letter-spacing: 0.04em;
    }
    .sc-start-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .sc-start-btn:not(:disabled):hover { opacity: 0.88; }

    /* STOP button */
    .sc-stop-btn {
      width: 100%; padding: 10px;
      background: transparent; color: #ff4444;
      font-size: 0.82rem; font-weight: 600;
      border: 1px solid #ff4444; border-radius: 8px;
      cursor: pointer; transition: all 0.2s;
    }
    .sc-stop-btn:hover { background: rgba(255,68,68,0.08); }

    /* Status row */
    .sc-status-row {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 8px 10px;
      background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
      font-size: 0.72rem; flex-wrap: wrap;
    }
    .sc-status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #484f58; flex-shrink: 0;
    }
    .sc-status-dot.running {
      background: #b0ff44;
      animation: sc-pulse 1.4s ease-in-out infinite;
    }
    @keyframes sc-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
    .sc-status-text { color: #8a9ab0; }
    .sc-status-val { color: #e6edf3; font-weight: 600; }
    .sc-status-id { color: #484f58; font-family: monospace; font-size: 0.65rem; }

    .sc-error { font-size: 0.75rem; color: #ff4444; }
  `],
  template: `
    <div class="sc-wrap">

      <!-- VEHICLE -->
      <div class="sc-section">
        <span class="sc-label">Vehicle</span>
        <select class="sc-select" [(ngModel)]="selectedCarUid">
          <option value="">No vehicle</option>
          @for (car of cars(); track car.carUid) {
            <option [value]="car.carUid">
              {{ car.make }} {{ car.model }} {{ car.year }}
              {{ car.isVirtual ? '(virtual)' : '' }}
            </option>
          }
        </select>
      </div>

      <!-- MODE -->
      <div class="sc-section">
        <span class="sc-label">Mode</span>
        <div class="sc-mode-row">
          <button type="button" class="sc-mode-btn"
            [class.active]="mode() === 'random'"
            (click)="mode.set('random')">
            🎲 Random
          </button>
          <button type="button" class="sc-mode-btn"
            [class.active]="mode() === 'replay'"
            (click)="mode.set('replay')">
            ▶ Replay
          </button>
        </div>
        @if (mode() === 'replay') {
          <input class="sc-input" [(ngModel)]="logFile"
            placeholder="C:/path/to/log_file.txt">
        }
      </div>

      <!-- FREQUENCY -->
      <div class="sc-section">
        <span class="sc-label">Frequency</span>
        <div class="sc-slider-row">
          <input type="range" class="sc-slider"
            min="1" max="20" step="1"
            [(ngModel)]="frequency">
          <span class="sc-slider-val">{{ frequency }} Hz</span>
        </div>
      </div>

      <!-- FAULT INJECTION -->
      <div class="sc-section">
        <span class="sc-label">Fault Injection</span>
        <div class="sc-checks">
          <label class="sc-check-label">
            <input type="checkbox" [(ngModel)]="injectTimingGaps">
            ⚠ Timing gaps (random 16–20s gaps)
          </label>
          <label class="sc-check-label">
            <input type="checkbox" [(ngModel)]="injectCounterErrors">
            ⚠ Counter errors
          </label>
          <label class="sc-check-label">
            <input type="checkbox" [(ngModel)]="injectValueErrors">
            ⚠ Signal range violations
          </label>
          @if (injectValueErrors || injectTimingGaps || injectCounterErrors) {
            <div class="sc-slider-row" style="margin-top:0.25rem">
              <span style="font-size:0.72rem;color:#8a9ab0;min-width:64px">Fault rate</span>
              <input type="range" class="sc-slider"
                min="0.01" max="0.5" step="0.01"
                [(ngModel)]="faultRate">
              <span class="sc-slider-val">{{ (faultRate * 100).toFixed(0) }}%</span>
            </div>
          }
        </div>
      </div>

      <!-- START / STOP -->
      @if (!simId()) {
        <button type="button" class="sc-start-btn"
          [disabled]="starting()"
          (click)="startSimulator()">
          {{ starting() ? 'Starting…' : '▶ START SIMULATOR' }}
        </button>
      } @else {
        <button type="button" class="sc-stop-btn"
          (click)="stopSimulator()">
          ⏹ Stop Simulator
        </button>
      }

      @if (error()) {
        <p class="sc-error">{{ error() }}</p>
      }

      <!-- STATUS ROW -->
      <div class="sc-status-row">
        <span class="sc-status-dot" [class.running]="!!simId()"></span>
        <span class="sc-status-text">Status:</span>
        <span class="sc-status-val">{{ simId() ? 'Running' : 'Idle' }}</span>
        @if (simId()) {
          <span class="sc-status-text">·</span>
          <span class="sc-status-text">Active:</span>
          <span class="sc-status-val">{{ activeCount() }}</span>
          @if (pid()) {
            <span class="sc-status-text">· PID:</span>
            <span class="sc-status-val">{{ pid() }}</span>
          }
          @if (startedAt()) {
            <span class="sc-status-text">· Started:</span>
            <span class="sc-status-val">
              {{ startedAt()! | slice:11:19 }}
            </span>
          }
          <span class="sc-status-text">·</span>
          <span class="sc-status-id">{{ simId()!.substring(0, 8) }}…</span>
        }
      </div>

    </div>
  `,
})
export class SimulatorControlComponent implements OnInit {
  @Output() simulatorStarted = new EventEmitter<void>();
  @Output() simulatorStopped = new EventEmitter<void>();

  private readonly http           = inject(HttpClient);
  private readonly simulatorState = inject(SimulatorStateService);
  private readonly destroyRef     = inject(DestroyRef);
  private readonly base           = `${API_BASE_URL}/api/simulator`;

  // ── Vehicle state ─────────────────────────────────────────────────────────
  readonly cars = signal<Car[]>([]);
  selectedCarUid = '';

  // ── Simulator config ──────────────────────────────────────────────────────
  readonly mode     = signal<'random' | 'replay'>('random');
  readonly simId    = this.simulatorState.simId;
  readonly starting = signal(false);
  readonly error    = signal<string | null>(null);

  logFile           = 'C:/tools/Kpit_c/log_file.txt';
  frequency         = 10;
  loop              = false;
  injectValueErrors = false;
  injectTimingGaps  = true;
  injectCounterErrors = false;
  faultRate         = 0.05;

  // ── Status polling ────────────────────────────────────────────────────────
  readonly activeCount  = signal(0);
  readonly pid          = signal<number | null>(null);
  readonly startedAt    = signal<string | null>(null);

  ngOnInit(): void {
    this.loadCars();
    // Poll status every 2s when a simulator is running
    interval(2_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.simId()) this.pollStatus();
      });
  }

  startSimulator(): void {
    this.starting.set(true);
    this.error.set(null);
    const body = {
      mode:               this.mode(),
      logFile:            this.mode() === 'replay' ? this.logFile : '',
      speed:              this.frequency / 10, // map Hz slider to speed multiplier
      loop:               this.loop,
      carUid:             this.selectedCarUid || null,
      injectValueErrors:  this.injectValueErrors,
      injectTimingGaps:   this.injectTimingGaps,
      injectCounterErrors: this.injectCounterErrors,
      faultRate:          this.faultRate,
    };
    this.http.post<{ simId: string; status: string }>(
      `${this.base}/start`, body, { headers: this.authHeaders() }
    ).subscribe({
      next: (res) => {
        this.simulatorState.setRunning(res.simId);
        this.starting.set(false);
        this.simulatorStarted.emit();
      },
      error: (err) => {
        this.starting.set(false);
        this.error.set(err?.error?.error ?? 'Failed to start simulator');
      },
    });
  }

  stopSimulator(): void {
    const id = this.simId();
    if (!id) return;
    this.http.post(`${this.base}/stop/${id}`, {}, { headers: this.authHeaders() })
      .subscribe({
        next: () => {
          this.simulatorState.setStopped();
          this.simulatorStopped.emit();
        },
        error: () => this.simulatorState.setStopped(),
      });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private loadCars(): void {
    this.http
      .get<Car[]>(`${API_BASE_URL}/api/cars`, { headers: this.authHeaders() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cars) => this.cars.set(cars),
        error: () => {},
      });
  }

  private pollStatus(): void {
    this.http
      .get<SimStatus>(`${this.base}/status`, { headers: this.authHeaders() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.activeCount.set(s.count);
          this.pid.set(s.pid ?? null);
          this.startedAt.set(s.startedAt ?? null);
        },
        error: () => {},
      });
  }

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('access_token');
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }
}
