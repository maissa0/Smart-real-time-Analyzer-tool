import {
  ChangeDetectionStrategy, Component, inject,
  signal, computed, OnInit, OnDestroy, input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LiveTelemetryService } from '../../../core/services/live-telemetry.service';
import { API_BASE_URL } from '../../../core/config/api.config';

@Component({
  selector: 'app-live-pipeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="px-4 py-2.5 bg-gray-900 border-b border-lime-400/[8%] flex flex-col gap-1.5">

      <div class="flex items-center gap-2 mb-1">
        <span class="w-[7px] h-[7px] rounded-full bg-lime-400 animate-pulse shrink-0"></span>
        <span class="text-[0.62rem] font-bold tracking-[0.15em] text-lime-400 uppercase">Live Pipeline</span>
        <span class="font-mono text-[0.68rem] text-zinc-500 ml-auto">{{ elapsedTime() }}</span>
      </div>

      <div class="grid grid-cols-4 gap-2">

        <!-- Simulator generated -->
        <div class="flex flex-col gap-1 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5">
          <div class="flex items-center gap-1.5">
            <span class="text-[0.7rem]">🎯</span>
            <span class="text-[0.6rem] text-zinc-500 uppercase tracking-[0.08em]">Simulator</span>
          </div>
          <span class="text-[0.82rem] font-bold font-mono text-slate-100">{{ wsFrames() | number }}</span>
          <div class="h-[3px] bg-zinc-800 rounded-sm overflow-hidden">
            <div class="h-full rounded-sm transition-[width] duration-300 bg-lime-400" style="width:100%"></div>
          </div>
          <span class="text-[0.58rem] text-zinc-500">{{ fps() }} fps</span>
        </div>

        <!-- WebSocket received -->
        <div class="flex flex-col gap-1 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5">
          <div class="flex items-center gap-1.5">
            <span class="text-[0.7rem]">📡</span>
            <span class="text-[0.6rem] text-zinc-500 uppercase tracking-[0.08em]">WS Received</span>
          </div>
          <span class="text-[0.82rem] font-bold font-mono text-slate-100">{{ wsFrames() | number }}</span>
          <div class="h-[3px] bg-zinc-800 rounded-sm overflow-hidden">
            <div class="h-full rounded-sm transition-[width] duration-300 bg-blue-500" [style.width]="wsPercent() + '%'"></div>
          </div>
          <span class="text-[0.58rem] text-zinc-500">real-time</span>
        </div>

        <!-- MySQL saved -->
        <div class="flex flex-col gap-1 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5">
          <div class="flex items-center gap-1.5">
            <span class="text-[0.7rem]">🗄️</span>
            <span class="text-[0.6rem] text-zinc-500 uppercase tracking-[0.08em]">MySQL Saved</span>
          </div>
          <span class="text-[0.82rem] font-bold font-mono text-slate-100">{{ mysqlFrames() | number }}</span>
          <div class="h-[3px] bg-zinc-800 rounded-sm overflow-hidden">
            <div class="h-full rounded-sm transition-[width] duration-300 bg-emerald-500" [style.width]="mysqlPercent() + '%'"></div>
          </div>
          <span class="text-[0.58rem] text-zinc-500">~2s delay</span>
        </div>

        <!-- InfluxDB signals -->
        <div class="flex flex-col gap-1 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5">
          <div class="flex items-center gap-1.5">
            <span class="text-[0.7rem]">📈</span>
            <span class="text-[0.6rem] text-zinc-500 uppercase tracking-[0.08em]">InfluxDB Pts</span>
          </div>
          <span class="text-[0.82rem] font-bold font-mono text-slate-100">{{ influxPoints() | number }}</span>
          <div class="h-[3px] bg-zinc-800 rounded-sm overflow-hidden">
            <div class="h-full rounded-sm transition-[width] duration-300 bg-violet-500" [style.width]="influxPercent() + '%'"></div>
          </div>
          <span class="text-[0.58rem] text-zinc-500">real-time</span>
        </div>

      </div>
    </div>
  `,
})
export class LivePipelineComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  readonly liveTelemetry = inject(LiveTelemetryService);

  readonly sessionId = input<string>('');

  private readonly _wsFramesTarget = computed(() => this.liveTelemetry.frameCount());
  readonly wsFrames = signal<number>(0);
  readonly mysqlFrames = signal<number>(0);
  readonly elapsedSeconds = signal<number>(0);
  readonly influxPoints = signal<number>(0);

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

  readonly influxPercent = computed(() =>
    Math.min(100, Math.round((this.influxPoints() / Math.max(this.wsFrames(), 1)) * 100))
  );

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _clockTimer: ReturnType<typeof setInterval> | null = null;
  private _animTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this._pollTimer = setInterval(() => {
      const sid = this.sessionId();
      if (!sid) return;
      this.http.get<any>(`${API_BASE_URL}/api/can/sessions/${sid}/pipeline-stats`).subscribe({
        next: s => {
          this.mysqlFrames.set(s.mysqlFrames ?? 0);
          if ((s.influxPoints ?? -1) >= 0) {
            this.influxPoints.set(s.influxPoints);
          }
        },
        error: () => {},
      });
    }, 3000);

    this._clockTimer = setInterval(() => {
      this.elapsedSeconds.update(n => n + 1);
    }, 1000);

    this._animTimer = setInterval(() => {
      const wsTarget = this._wsFramesTarget();
      const wsCurrent = this.wsFrames();
      if (wsCurrent < wsTarget) {
        const step = Math.ceil((wsTarget - wsCurrent) / 4);
        this.wsFrames.set(Math.min(wsTarget, wsCurrent + step));
      }
    }, 60);
  }

  ngOnDestroy(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._clockTimer) clearInterval(this._clockTimer);
    if (this._animTimer) clearInterval(this._animTimer);
  }
}
