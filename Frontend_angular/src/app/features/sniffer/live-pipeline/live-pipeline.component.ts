import {
  ChangeDetectionStrategy, Component, inject,
  signal, computed, OnInit, OnDestroy, input
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
      background: #0d1117;
      border: 1px solid rgba(176,255,68,0.12);
      border-radius: 10px;
      padding: 0.75rem 1rem;
      margin-bottom: 0.5rem;
      font-size: 0.72rem;
    }
    .pipeline-title {
      font-size: 0.62rem; font-weight: 700;
      letter-spacing: 0.15em; color: #b0ff44;
      text-transform: uppercase; margin: 0 0 0.6rem;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .live-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #b0ff44;
      animation: pulse 1.4s ease-in-out infinite;
      flex-shrink: 0;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .pipeline-row {
      display: flex; align-items: center;
      gap: 0.5rem; margin-bottom: 0.4rem;
    }
    .pipeline-label {
      font-size: 0.65rem; color: #484f58;
      width: 110px; flex-shrink: 0;
    }
    .pipeline-bar-wrap {
      flex: 1; height: 6px; background: #161b22;
      border-radius: 3px; overflow: hidden;
    }
    .pipeline-bar {
      height: 100%; border-radius: 3px;
      transition: width 0.3s ease;
    }
    .pipeline-count {
      font-size: 0.68rem; color: #e6edf3;
      font-weight: 600; min-width: 60px;
      text-align: right; font-family: monospace;
    }
    .pipeline-lag {
      font-size: 0.62rem; color: #f0a500;
      margin-top: 0.25rem; text-align: right;
    }
    .timer {
      font-family: monospace; font-size: 0.72rem;
      color: #e6edf3; margin-left: auto;
    }
    .stage-icon { font-size: 0.7rem; }
  `],
  template: `
    <div class="pipeline">
      <div class="pipeline-title">
        <span class="live-dot"></span>
        Live Pipeline
        <span class="timer">{{ elapsedTime() }}</span>
      </div>

      <!-- WebSocket received (most real-time) -->
      <div class="pipeline-row">
        <span class="stage-icon">📡</span>
        <span class="pipeline-label">WS Received</span>
        <div class="pipeline-bar-wrap">
          <div class="pipeline-bar"
            style="background:#b0ff44"
            [style.width]="wsPercent() + '%'">
          </div>
        </div>
        <span class="pipeline-count">{{ wsFrames() | number }}</span>
      </div>

      <!-- MySQL saved (polled every 2s) -->
      <div class="pipeline-row">
        <span class="stage-icon">🗄️</span>
        <span class="pipeline-label">MySQL Saved</span>
        <div class="pipeline-bar-wrap">
          <div class="pipeline-bar"
            style="background:#3b82f6"
            [style.width]="mysqlPercent() + '%'">
          </div>
        </div>
        <span class="pipeline-count">{{ mysqlFrames() | number }}</span>
      </div>

      <!-- InfluxDB (same as MySQL for now — signals written per frame) -->
      <div class="pipeline-row">
        <span class="stage-icon">📈</span>
        <span class="pipeline-label">InfluxDB Pts</span>
        <div class="pipeline-bar-wrap">
          <div class="pipeline-bar"
            style="background:#8b5cf6"
            [style.width]="influxPercent() + '%'">
          </div>
        </div>
        <span class="pipeline-count">~{{ influxEstimate() | number }}</span>
      </div>

      @if (lag() > 5) {
        <div class="pipeline-lag">
          ⚠ Pipeline lag: {{ lag() }} frames behind
        </div>
      }
    </div>
  `,
})
export class LivePipelineComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  readonly liveTelemetry = inject(LiveTelemetryService);

  readonly sessionId = input<string>('');
  readonly sessionFrameCount = input<number>(0);

  readonly wsFrames = computed(() => this.liveTelemetry.frameCount());
  readonly mysqlFrames = signal<number>(0);
  readonly elapsedSeconds = signal<number>(0);
  readonly elapsedTime = computed(() => {
    const elapsed = this.elapsedSeconds();
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
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

  // Estimate InfluxDB points — average ~3 signals per frame
  readonly influxEstimate = computed(() =>
    Math.round(this.mysqlFrames() * 3)
  );

  readonly influxPercent = computed(() =>
    Math.min(100, Math.round((this.influxEstimate() / (this.maxFrames() * 3)) * 100))
  );

  readonly lag = computed(() =>
    Math.max(0, this.wsFrames() - this.mysqlFrames())
  );

  private _timer: ReturnType<typeof setInterval> | null = null;
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
        `${API_BASE_URL}/api/can/sessions/${sid}`,
        { headers }
      ).subscribe({
        next: s => this.mysqlFrames.set(s.frameCount ?? 0),
        error: () => {}
      });
    }, 2000);
    // Update elapsed time every second
    this._clockTimer = setInterval(() => {
      this.elapsedSeconds.update(n => n + 1);
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._clockTimer) clearInterval(this._clockTimer);
    if (this._timer) clearInterval(this._timer);
  }
}
