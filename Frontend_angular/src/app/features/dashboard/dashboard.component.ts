import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, DecimalPipe } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { Router } from '@angular/router';
import { interval } from 'rxjs';
import { Chart, ArcElement, DoughnutController, Tooltip } from 'chart.js';
import { LiveTelemetryService } from '../../core/services/live-telemetry.service';
import { DashboardStore } from './dashboard.store';
import { KpiCardComponent } from './kpi-card/kpi-card.component';
import { MessageFrequencyChartComponent } from './message-frequency-chart/message-frequency-chart.component';

// Register only what we need — avoids bundling the entire Chart.js library
Chart.register(ArcElement, DoughnutController, Tooltip);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DecimalPipe, HttpClientModule, KpiCardComponent, MessageFrequencyChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6">

      <!-- ── Header ────────────────────────────────────────────────────── -->
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div class="flex items-center gap-3 text-sm text-gray-500">
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-2 w-2 rounded-full"
              [class.bg-green-500]="liveTelemetry.connected()"
              [class.animate-pulse]="liveTelemetry.connected()"
              [class.bg-red-400]="!liveTelemetry.connected()">
            </span>
            WebSocket {{ liveTelemetry.connected() ? 'Connected' : 'Disconnected' }}
          </span>
          <span class="text-xs text-gray-400 border-l pl-3">
            Auto-refresh every 30s
          </span>
        </div>
      </div>

      <!-- ── Loading ───────────────────────────────────────────────────── -->
      @if (store.isLoading() && !store.stats()) {
        <div class="flex items-center justify-center py-20 text-gray-400">
          <svg class="animate-spin h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10"
              stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Loading dashboard data...
        </div>
      }

      <!-- ── Error ─────────────────────────────────────────────────────── -->
      @if (store.error()) {
        <div class="rounded-lg bg-red-50 border border-red-200 p-4
                    text-red-700 text-sm">
          ⚠️ {{ store.error() }}
        </div>
      }

      @if (store.stats(); as stats) {

        <!-- ── KPI Cards ────────────────────────────────────────────────── -->
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <app-kpi-card
            label="Sessions"
            [value]="stats.sessionCount"
            [sub]="stats.activeSessions + ' live'"
            [isLive]="stats.activeSessions > 0" />

          <app-kpi-card
            label="Total Frames"
            [value]="stats.totalFrames"
            sub="CAN frames in DB"
            [isLive]="liveTelemetry.connected()" />

          <app-kpi-card
            label="Integrity Faults"
            [value]="stats.totalFaults"
            sub="across all sessions"
            [isLive]="false" />

          <app-kpi-card
            label="Vehicles"
            [value]="stats.totalCars"
            sub="registered in fleet"
            [isLive]="false" />
        </div>

        <!-- ── Middle row: Top Messages + Fault Donut ──────────────────── -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">

          <!-- Top Message IDs — Chart.js bar chart -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <h2 class="text-sm font-semibold text-gray-700 mb-4">
              Top Message IDs
            </h2>
            @if (stats.topMessageIds.length > 0) {
              <app-message-frequency-chart
                [data]="stats.topMessageIds" />
            } @else {
              <p class="text-xs text-gray-400 py-8 text-center">
                No frames yet
              </p>
            }
          </div>

          <!-- Fault Distribution — Chart.js doughnut -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <h2 class="text-sm font-semibold text-gray-700 mb-4">
              Fault Distribution
            </h2>
            @if (stats.totalFaults > 0) {
              <div class="flex items-center gap-6">
                <!-- Donut canvas — fixed size for projector readability -->
                <div class="shrink-0" style="width:140px; height:140px;">
                  <canvas #faultChart></canvas>
                </div>
                <!-- Text labels to the right — no Chart.js legend plugin -->
                <div class="space-y-3 text-sm">
                  @for (entry of faultEntries(stats.faultsByType);
                        track entry.type) {
                    <div class="flex items-center gap-2">
                      <span class="inline-block w-3 h-3 rounded-sm shrink-0"
                        [style.background]="faultColor(entry.type)">
                      </span>
                      <span class="text-gray-600">{{ entry.type }}</span>
                      <span class="ml-auto font-medium pl-4"
                        [style.color]="faultColor(entry.type)">
                        {{ faultPct(entry.count, stats.faultsByType) }}%
                      </span>
                    </div>
                  }
                </div>
              </div>
            } @else {
              <p class="text-xs text-green-600 py-8 text-center">
                ✓ No faults detected
              </p>
            }
          </div>

        </div>

        <!-- ── Recent Sessions ──────────────────────────────────────────── -->
        <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-semibold text-gray-700">Recent Sessions</h2>
            <button
              class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              (click)="goTo('/admin/sniffer')">
              View All →
            </button>
          </div>
          <div class="divide-y divide-gray-50">
            @for (s of store.recentSessions(); track s.sessionId) {
              <div
                class="flex items-center justify-between py-3 cursor-pointer
                       hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                (click)="openSession(s.sessionId)">
                <div class="min-w-0">
                  <p class="font-mono text-xs text-gray-600 truncate">
                    {{ s.sessionId }}
                  </p>
                  @if (s.sourceFilename) {
                    <p class="text-xs text-gray-400 mt-0.5">
                      {{ s.sourceFilename }}
                    </p>
                  }
                </div>
                <div class="text-right shrink-0 ml-4">
                  <p class="text-xs font-medium text-gray-700">
                    {{ s.frameCount | number }} frames
                  </p>
                  @if (s.createdAt) {
                    <p class="text-xs text-gray-400">
                      {{ formatDate(s.createdAt) }}
                    </p>
                  }
                </div>
              </div>
            }
            @if (store.recentSessions().length === 0) {
              <p class="text-xs text-gray-400 py-4 text-center">
                No sessions yet
              </p>
            }
          </div>
        </div>

        <!-- ── Quick Actions ────────────────────────────────────────────── -->
        <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
          <h2 class="text-sm font-semibold text-gray-700 mb-4">Quick Actions</h2>
          <div class="flex flex-wrap gap-3">
            <button
              class="flex items-center gap-2 px-4 py-2 rounded-lg
                     bg-[#b0ff44] text-gray-900 text-sm font-medium
                     hover:brightness-110 transition-all"
              (click)="goTo('/admin/simulator')">
              <svg class="w-4 h-4" fill="none" stroke="currentColor"
                   viewBox="0 0 24 24" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Start Simulator
            </button>
            <button
              class="flex items-center gap-2 px-4 py-2 rounded-lg
                     border border-gray-200 text-gray-700 text-sm
                     hover:bg-gray-50 transition-all"
              (click)="goTo('/admin/upload')">
              <svg class="w-4 h-4" fill="none" stroke="currentColor"
                   viewBox="0 0 24 24" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Upload Log
            </button>
            <button
              class="flex items-center gap-2 px-4 py-2 rounded-lg
                     border border-gray-200 text-gray-700 text-sm
                     hover:bg-gray-50 transition-all"
              (click)="goTo('/admin/monitor')">
              <svg class="w-4 h-4" fill="none" stroke="currentColor"
                   viewBox="0 0 24 24" stroke-width="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              Live Monitor
            </button>
            <button
              class="flex items-center gap-2 px-4 py-2 rounded-lg
                     border border-gray-200 text-gray-700 text-sm
                     hover:bg-gray-50 transition-all"
              (click)="goTo('/admin/vehicles')">
              <svg class="w-4 h-4" fill="none" stroke="currentColor"
                   viewBox="0 0 24 24" stroke-width="2">
                <rect x="1" y="11" width="22" height="9" rx="2" ry="2"/>
                <path d="M1 11l4-7h14l4 7"/>
                <circle cx="7" cy="20" r="1"/>
                <circle cx="17" cy="20" r="1"/>
              </svg>
              Vehicles
            </button>
          </div>
        </div>

      }
    </div>
  `,
})
export class DashboardComponent implements OnInit, AfterViewInit {
  readonly liveTelemetry = inject(LiveTelemetryService);
  readonly store         = inject(DashboardStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router     = inject(Router);

  @ViewChild('faultChart') faultChartRef!: ElementRef<HTMLCanvasElement>;
  private chart: Chart<'doughnut'> | null = null;

  // Fault type → display color
  private readonly FAULT_COLORS: Record<string, string> = {
    SIGNAL_RANGE: '#ff4444',
    TIMING_GAP:   '#ffaa00',
    DUPLICATE:    '#4488ff',
  };
  private readonly OTHER_COLOR = '#8b949e';

  constructor() {
    // React to stats changes — use setTimeout(0) to let Angular
    // finish rendering the @if block before accessing the canvas.
    effect(() => {
      const stats = this.store.stats();
      if (stats && stats.totalFaults > 0) {
        setTimeout(() => this.updateChart(stats.faultsByType), 0);
      }
    });
  }

  ngOnInit(): void {
    this.store.loadStats();
    interval(30_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.store.loadStats());
  }

  ngAfterViewInit(): void {
    // Chart is created after first stats load via effect()
  }

  // ── Chart ────────────────────────────────────────────────────────────────

  private updateChart(faultsByType: Record<string, number>): void {
    const entries = Object.entries(faultsByType);
    if (entries.length === 0) return;

    const labels = entries.map(([type]) => type);
    const data   = entries.map(([, count]) => count);
    const colors = labels.map((l) => this.FAULT_COLORS[l] ?? this.OTHER_COLOR);

    if (this.chart) {
      // Update existing chart data in place
      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data   = data;
      this.chart.data.datasets[0].backgroundColor = colors;
      this.chart.update('none'); // 'none' = no animation on refresh
      return;
    }

    const canvas = this.faultChartRef?.nativeElement;
    if (!canvas) return;

    this.chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverBorderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '68%',        // thin ring — more readable at projector res
        plugins: {
          legend: { display: false },   // no legend — labels shown as text
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = (ctx.dataset.data as number[])
                  .reduce((a, b) => a + b, 0);
                const pct = total > 0
                  ? Math.round(((ctx.raw as number) / total) * 100)
                  : 0;
                return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  goTo(path: string): void {
    this.router.navigate([path]);
  }

  openSession(sessionId: string): void {
    this.router.navigate(['/admin/sniffer'], { queryParams: { sessionId } });
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  }

  faultEntries(
    faultsByType: Record<string, number>
  ): Array<{ type: string; count: number }> {
    return Object.entries(faultsByType).map(([type, count]) => ({
      type, count,
    }));
  }

  faultColor(type: string): string {
    return this.FAULT_COLORS[type] ?? this.OTHER_COLOR;
  }

  faultPct(count: number, faultsByType: Record<string, number>): number {
    const total = Object.values(faultsByType).reduce((a, b) => a + b, 0);
    return total === 0 ? 0 : Math.round((count / total) * 100);
  }

  objectKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj);
  }
}
