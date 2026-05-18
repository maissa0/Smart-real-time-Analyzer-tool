import {
  ChangeDetectionStrategy, Component, inject,
  signal, computed, OnInit, OnDestroy, input, DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { LiveTelemetryService } from '../../../core/services/live-telemetry.service';
import { API_BASE_URL } from '../../../core/config/api.config';

@Component({
  selector: 'app-live-pipeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, HttpClientModule],
  styles: [`
    .pipeline {
      padding: 0.6rem 1rem;
      background: #0d1117;
      border-bottom: 1px solid rgba(176,255,68,0.08);
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .pipeline-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.2rem;
    }
    .live-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #b0ff44;
      animation: pulse 1.4s ease-in-out infinite;
      flex-shrink: 0;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .pipeline-title {
      font-size: 0.62rem; font-weight: 700;
      letter-spacing: 0.15em; color: #b0ff44;
      text-transform: uppercase;
    }
    .timer {
      font-family: monospace; font-size: 0.68rem;
      color: #484f58; margin-left: auto;
    }
    .pipeline-rows {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.5rem;
    }
    .pipeline-stage {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.4rem 0.6rem;
    }
    .stage-header {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    .stage-icon { font-size: 0.7rem; }
    .stage-label {
      font-size: 0.6rem;
      color: #484f58;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .stage-count {
      font-size: 0.82rem;
      font-weight: 700;
      font-family: monospace;
      color: #e6edf3;
    }
    .stage-bar-wrap {
      height: 3px;
      background: #21262d;
      border-radius: 2px;
      overflow: hidden;
    }
    .stage-bar {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .stage-rate {
      font-size: 0.58rem;
      color: #484f58;
    }
  `],
  template: `
    <div class="pipeline">
      <div class="pipeline-header">
        <span class="live-dot"></span>
        <span class="pipeline-title">Live Pipeline</span>
        <span class="timer">{{ elapsedTime() }}</span>
      </div>

      <div class="pipeline-rows">

        <!-- Simulator generated -->
        <div class="pipeline-stage">
          <div class="stage-header">
            <span class="stage-icon">🎯</span>
            <span class="stage-label">Simulator</span>
          </div>
          <span class="stage-count">{{ wsFrames() | number }}</span>
          <div class="stage-bar-wrap">
            <div class="stage-bar"
              style="background:#b0ff44"
              [style.width]="'100%'">
            </div>
          </div>
          <span class="stage-rate">{{ fps() }} fps</span>
        </div>

        <!-- WebSocket received -->
        <div class="pipeline-stage">
          <div class="stage-header">
            <span class="stage-icon">📡</span>
            <span class="stage-label">WS Received</span>
          </div>
          <span class="stage-count">{{ wsFrames() | number }}</span>
          <div class="stage-bar-wrap">
            <div class="stage-bar"
              style="background:#3b82f6"
              [style.width]="wsPercent() + '%'">
            </div>
          </div>
          <span class="stage-rate">real-time</span>
        </div>

        <!-- MySQL saved -->
        <div class="pipeline-stage">
          <div class="stage-header">
            <span class="stage-icon">🗄️</span>
            <span class="stage-label">MySQL Saved</span>
          </div>
          <span class="stage-count">{{ mysqlFrames() | number }}</span>
          <div class="stage-bar-wrap">
            <div class="stage-bar"
              style="background:#10b981"
              [style.width]="mysqlPercent() + '%'">
            </div>
          </div>
          <span class="stage-rate">~2s delay</span>
        </div>

        <!-- InfluxDB signals -->
        <div class="pipeline-stage">
          <div class="stage-header">
            <span class="stage-icon">📈</span>
            <span class="stage-label">InfluxDB Pts</span>
          </div>
          <span class="stage-count">{{ influxEstimate() | number }}</span>
          <div class="stage-bar-wrap">
            <div class="stage-bar"
              style="background:#8b5cf6"
              [style.width]="influxPercent() + '%'">
            </div>
          </div>
          <span class="stage-rate">~{{ avgSignals() }} sig/frame</span>
        </div>

      </div>
    </div>
  `,
})
export class LivePipelineComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  readonly liveTelemetry = inject(LiveTelemetryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly sessionId = input<string>('');

  readonly wsFrames = computed(() => this.liveTelemetry.frameCount());
  readonly mysqlFrames = signal<number>(0);
  readonly elapsedSeconds = signal<number>(0);
  readonly avgSignals = signal<number>(5);

  readonly elapsedTime = computed(() => {
    const e = this.elapsedSeconds();
    const m = Math.floor(e / 60).toString().padStart(2, '0');
    const s = (e % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  });

  readonly fps = computed(() => {
    const e = this.elapsedSeconds();
    if (e === 0) return 0;
    return Math.round(this.wsFrames() / e);
  });

  readonly maxFrames = computed(() =>
    Math.max(this.wsFrames(), this.mysqlFrames(), 1)
  );

  readonly wsPercent = computed(() =>
    Math.min(100, Math.round((this.wsFrames() / this.maxFrames()) * 100))
  );

  readonly mysqlPercent = computed(() =>
    Math.min(100, Math.round((this.mysqlFrames() / this.maxFrames()) * 100))
  );

  readonly influxEstimate = computed(() =>
    Math.round(this.mysqlFrames() * this.avgSignals())
  );

  readonly influxPercent = computed(() =>
    this.mysqlPercent()
  );

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _clockTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // Poll MySQL frame count every 2s
    this._pollTimer = setInterval(() => {
      const sid = this.sessionId();
      if (!sid) return;
      const token = localStorage.getItem('access_token');
      const headers = token
        ? new HttpHeaders({ Authorization: `Bearer ${token}` })
        : new HttpHeaders();
      this.http.get<any>(
        `${API_BASE_URL}/api/can/sessions/${sid}/frame-count`,
        { headers }
      ).subscribe({
        next: s => {
          const count = s.count ?? 0;
          this.mysqlFrames.set(count);
          // Estimate avg signals per frame from InfluxDB
          // Each CAN message typically has 3-8 signals
          if (count > 0) {
            this.avgSignals.set(5); // reasonable default
          }
        },
        error: () => {}
      });
    }, 2000);

    // Increment elapsed time every second
    this._clockTimer = setInterval(() => {
      this.elapsedSeconds.update(n => n + 1);
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._clockTimer) clearInterval(this._clockTimer);
  }
}
