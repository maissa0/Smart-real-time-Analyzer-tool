import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Input, Output, EventEmitter } from '@angular/core';
import { interval } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { SimulatorStateService } from './simulator-state.service';

interface Car {
  carUid: string;
  make: string;
  model: string;
  year: number;
  isVirtual: boolean;
}

interface CarCatalog {
  filename: string;
  name: string;
  busName: string;
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
    .sc-wrap {
      display: flex; flex-direction: column; gap: 1rem; width: 100%;
      box-sizing: border-box; overflow: hidden;
      font-family: var(--kpit-font-sans, 'IBM Plex Sans', system-ui, sans-serif);
    }

    /* Section label */
    .sc-section { display: flex; flex-direction: column; gap: 0.5rem; }
    .sc-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
      color: #8a9ab0; text-transform: uppercase;
    }

    /* Select / input base */
    .sc-select, .sc-input {
      width: 100%;
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 6px;
      color: #e6edf3;
      font-size: 13px;
      padding: 7px 10px;
      outline: none;
      transition: border-color 0.2s;
      font-family: inherit;
    }
    .sc-input { font-family: var(--kpit-font-mono, monospace); }
    .sc-select:focus, .sc-input:focus { border-color: rgba(176,255,68,0.5); }

    /* Mode radio buttons */
    .sc-mode-row { display: flex; gap: 0.5rem; }
    .sc-mode-btn {
      flex: 1; padding: 8px; border-radius: 6px; font-size: 12.5px;
      font-weight: 600; border: 1px solid #21262d;
      background: transparent; color: #8a9ab0; cursor: pointer;
      transition: all 0.2s; text-align: center; font-family: inherit;
    }
    .sc-mode-btn.active {
      border-color: #b0ff44; color: #b0ff44;
      background: rgba(176,255,68,0.08);
    }

    /* Slider */
    .sc-slider-row { display: flex; align-items: center; gap: 0.5rem; width: 100%; min-width: 0; }
    .sc-slider {
      flex: 1; min-width: 0; accent-color: #b0ff44; cursor: pointer; width: 0;
    }
    .sc-slider-val {
      font-size: 12.5px; font-weight: 700; color: #b0ff44;
      min-width: 44px; text-align: right; flex-shrink: 0;
      font-family: var(--kpit-font-mono, monospace);
    }

    /* Fault-injection toggles: bordered rows with square checkboxes */
    .sc-checks { display: flex; flex-direction: column; gap: 0.4rem; }
    .sc-check-label {
      display: flex; align-items: center; gap: 0.6rem;
      font-size: 12.5px; color: #e6edf3; cursor: pointer;
      border: 1px solid #21262d; border-radius: 6px;
      padding: 9px 12px; background: #0d1117;
      transition: border-color 0.15s;
    }
    .sc-check-label:hover { border-color: rgba(176,255,68,0.3); }
    .sc-check-label input[type="checkbox"] {
      accent-color: #b0ff44; width: 14px; height: 14px; flex-shrink: 0;
    }

    /* Footer: status dot left · Cancel + Start right */
    .sc-footer {
      display: flex; align-items: center; gap: 0.6rem;
      border-top: 1px solid #21262d; padding-top: 0.9rem; flex-wrap: wrap;
    }
    .sc-status-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #484f58; flex-shrink: 0;
    }
    .sc-status-dot.running {
      background: #b0ff44;
      animation: sc-pulse 1.4s ease-in-out infinite;
    }
    @keyframes sc-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
    .sc-status-text { color: #8a9ab0; font-size: 12px; }
    .sc-status-val { color: #e6edf3; font-weight: 600; font-size: 12px; }
    .sc-status-id {
      color: #484f58; font-family: var(--kpit-font-mono, monospace); font-size: 11px;
    }
    .sc-footer-spacer { flex: 1; }

    .sc-cancel-btn {
      padding: 9px 16px; border-radius: 7px; font-size: 12.5px; font-weight: 600;
      border: 1px solid #21262d; background: transparent; color: #8a9ab0;
      cursor: pointer; font-family: inherit;
    }
    .sc-cancel-btn:hover { color: #e6edf3; border-color: rgba(176,255,68,0.3); }
    .sc-start-btn {
      padding: 9px 18px;
      background: #b0ff44; color: #07090b;
      font-size: 12.5px; font-weight: 700;
      border: none; border-radius: 7px;
      cursor: pointer; transition: opacity 0.2s;
      letter-spacing: 0.02em; font-family: inherit;
    }
    .sc-start-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .sc-start-btn:not(:disabled):hover { opacity: 0.88; }
    .sc-stop-btn {
      padding: 9px 18px;
      background: transparent; color: #ff4444;
      font-size: 12.5px; font-weight: 600;
      border: 1px solid rgba(255,68,68,0.5); border-radius: 7px;
      cursor: pointer; transition: all 0.2s; font-family: inherit;
    }
    .sc-stop-btn:hover { background: rgba(255,68,68,0.08); }

    .sc-error { font-size: 12.5px; color: #ff4444; margin: 0; }

    button:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid rgba(176,255,68,0.4); outline-offset: 1px;
    }
  `],
  template: `
    <div class="sc-wrap">

      <!-- VEHICLE (selector hidden when a car is preset by the host page) -->
      <div class="sc-section">
        <span class="sc-label">Vehicle</span>
        @if (!presetCarUid) {
          <select class="sc-select" [(ngModel)]="selectedCarUid"
            (ngModelChange)="onCarSelected($event)">
            <option value="">No vehicle</option>
            @for (car of cars(); track car.carUid) {
              <option [value]="car.carUid">
                {{ car.make }} {{ car.model }} {{ car.year }}
                {{ car.isVirtual ? '(virtual)' : '' }}
              </option>
            }
          </select>
        }
        @if (selectedCarUid) {
          <span class="sc-status-text">
            @if (carCatalogs().length > 0) {
              Catalogs: {{ catalogSummary() }}
            } @else {
              Catalogs: all (none assigned to this car)
            }
          </span>
        }
      </div>

      <!-- MODE -->
      <div class="sc-section">
        <span class="sc-label">Mode</span>
        <div class="sc-mode-row" role="group" aria-label="Simulator mode">
          <button type="button" class="sc-mode-btn"
            [class.active]="mode() === 'random'"
            (click)="mode.set('random')">
            Random traffic
          </button>
          <button type="button" class="sc-mode-btn"
            [class.active]="mode() === 'replay'"
            (click)="mode.set('replay')">
            Replay a session
          </button>
        </div>
        @if (mode() === 'replay') {
          <input class="sc-input" [(ngModel)]="logFile"
            placeholder="C:/path/to/log_file.txt">
        }
      </div>

      <!-- FREQUENCY / SPEED -->
      <div class="sc-section">
        <span class="sc-label">{{ mode() === 'replay' ? 'Playback speed' : 'Frame rate' }}</span>
        <div class="sc-slider-row">
          <input type="range" class="sc-slider"
            min="1" max="20" step="1"
            [attr.aria-label]="mode() === 'replay' ? 'Playback speed' : 'Frame rate'"
            [(ngModel)]="frequency">
          <span class="sc-slider-val">
            {{ mode() === 'replay' ? (frequency / 10) + '×' : frequency + ' Hz' }}
          </span>
        </div>
      </div>

      <!-- FAULT INJECTION -->
      <div class="sc-section">
        <span class="sc-label">Fault Injection</span>
        <div class="sc-checks">
          <label class="sc-check-label">
            <input type="checkbox" [(ngModel)]="injectTimingGaps">
            Timing gaps (random 16–20s gaps)
          </label>
          <label class="sc-check-label">
            <input type="checkbox" [(ngModel)]="injectCounterErrors">
            Counter errors
          </label>
          <label class="sc-check-label">
            <input type="checkbox" [(ngModel)]="injectValueErrors">
            Signal range violations
          </label>
          <label class="sc-check-label">
            <input type="checkbox" [(ngModel)]="injectDuplicates">
            Duplicate frames
          </label>
          @if (injectValueErrors || injectTimingGaps || injectCounterErrors || injectDuplicates) {
            <div class="sc-slider-row" style="margin-top:0.25rem">
              <span style="font-size:12px;color:#8a9ab0;min-width:64px">Fault rate</span>
              <input type="range" class="sc-slider"
                min="0.01" max="0.5" step="0.01"
                aria-label="Fault rate"
                [(ngModel)]="faultRate">
              <span class="sc-slider-val">{{ (faultRate * 100).toFixed(0) }}%</span>
            </div>
          }
        </div>
      </div>

      @if (error()) {
        <p class="sc-error">{{ error() }}</p>
      }

      <!-- FOOTER: run status left · Cancel + Start/Stop right -->
      <div class="sc-footer">
        <span class="sc-status-dot" [class.running]="!!simId()"></span>
        <span class="sc-status-val">{{ simId() ? 'Running' : 'Idle' }}</span>
        @if (simId()) {
          <span class="sc-status-text">· {{ activeCount() }} active</span>
          @if (pid()) {
            <span class="sc-status-text">· PID {{ pid() }}</span>
          }
          @if (startedAt()) {
            <span class="sc-status-text">· since {{ startedAt()! | slice:11:19 }}</span>
          }
          <span class="sc-status-id">{{ simId()!.substring(0, 8) }}…</span>
        }
        <span class="sc-footer-spacer"></span>
        @if (showCancel) {
          <button type="button" class="sc-cancel-btn" (click)="cancelled.emit()">Cancel</button>
        }
        @if (!simId()) {
          <button type="button" class="sc-start-btn"
            [disabled]="starting()"
            (click)="startSimulator()">
            {{ starting() ? 'Starting…' : 'Start simulator' }}
          </button>
        } @else {
          <button type="button" class="sc-stop-btn"
            (click)="stopSimulator()">
            Stop simulator
          </button>
        }
      </div>

    </div>
  `,
})
export class SimulatorControlComponent implements OnInit {
  /** Pre-selects a vehicle (e.g. when embedded on that car's fleet panel). */
  @Input() presetCarUid = '';
  /** Shows a Cancel button in the footer (for modal hosts). */
  @Input() showCancel = false;
  @Output() simulatorStarted = new EventEmitter<void>();
  @Output() simulatorStopped = new EventEmitter<void>();
  /** Emitted when the footer Cancel button is pressed (modal host closes). */
  @Output() cancelled = new EventEmitter<void>();

  private readonly http           = inject(HttpClient);
  private readonly simulatorState = inject(SimulatorStateService);
  private readonly destroyRef     = inject(DestroyRef);
  private readonly base           = `${API_BASE_URL}/api/simulator`;

  // ── Vehicle state ─────────────────────────────────────────────────────────
  readonly cars = signal<Car[]>([]);
  selectedCarUid = '';

  /** Catalogs assigned to the selected car — empty means "all catalogs". */
  readonly carCatalogs = signal<CarCatalog[]>([]);
  readonly catalogSummary = computed(() =>
    this.carCatalogs().map(c => c.busName || c.filename).join(', '));

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
  injectDuplicates = false;
  faultRate         = 0.05;

  // ── Status polling ────────────────────────────────────────────────────────
  readonly activeCount  = signal(0);
  readonly pid          = signal<number | null>(null);
  readonly startedAt    = signal<string | null>(null);

  ngOnInit(): void {
    this.loadCars();
    if (this.presetCarUid) {
      this.selectedCarUid = this.presetCarUid;
      this.onCarSelected(this.presetCarUid);
    }
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
      injectDuplicates:   this.injectDuplicates,
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

  onCarSelected(carUid: string): void {
    this.carCatalogs.set([]);
    if (!carUid) return;
    this.http
      .get<CarCatalog[]>(
        `${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}/catalogs`,
        { headers: this.authHeaders() })
      .subscribe({
        next: (catalogs) => this.carCatalogs.set(catalogs),
        error: () => {},
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
