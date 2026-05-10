import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  input,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import {
  ArcElement,
  Chart,
  DoughnutController,
  Tooltip,
} from 'chart.js';

// ArcElement and DoughnutController already registered in dashboard.component.ts.
// Re-registering is safe — Chart.js deduplicates.
Chart.register(ArcElement, DoughnutController, Tooltip);

export interface FaultEntry {
  type: string;
  count: number;
}

/**
 * Standalone doughnut chart — Fault Distribution by type.
 *
 * Color mapping (fixed order, jury-optimized):
 *   SIGNAL_RANGE → #ff4444  (red    — signal out of valid range)
 *   TIMING_GAP   → #ffaa00  (amber  — message arrived too late)
 *   DUPLICATE    → #4488ff  (blue   — duplicate frame < 1ms)
 *   other        → #8b949e  (grey)
 *
 * No Chart.js legend — custom HTML labels rendered to the right.
 * Empty state: shows "✅ No faults detected" when data is empty.
 *
 * Usage:
 * <app-fault-donut-chart [data]="faultEntries" />
 */
@Component({
  selector: 'app-fault-donut-chart',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; width: 100%; }
    .donut-wrap {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }
    .canvas-container {
      position: relative;
      width: 140px;
      height: 140px;
      flex-shrink: 0;
    }
    canvas {
      width: 100% !important;
      height: 100% !important;
    }
    .labels {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      font-size: 0.82rem;
    }
    .label-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .label-dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .label-type {
      color: #4b5563;
      flex: 1;
    }
    .label-pct {
      font-weight: 600;
      min-width: 36px;
      text-align: right;
    }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 140px;
      font-size: 0.82rem;
      color: #16a34a;
    }
  `],
  template: `
    @if (hasData()) {
      <div class="donut-wrap">
        <!-- Donut canvas -->
        <div class="canvas-container">
          <canvas #donutCanvas></canvas>
        </div>
        <!-- Custom HTML labels — no Chart.js legend plugin -->
        <div class="labels">
          @for (entry of data(); track entry.type) {
            <div class="label-row">
              <span class="label-dot"
                [style.background]="colorFor(entry.type)">
              </span>
              <span class="label-type">{{ entry.type }}</span>
              <span class="label-pct"
                [style.color]="colorFor(entry.type)">
                {{ pct(entry.count) }}%
              </span>
            </div>
          }
        </div>
      </div>
    } @else {
      <div class="empty-state">✅ No faults detected</div>
    }
  `,
})
export class FaultDonutChartComponent implements AfterViewInit, OnDestroy {

  /** Signal input — array of { type, count } from dashboard stats. */
  readonly data = input<FaultEntry[]>([]);

  readonly hasData = computed(() =>
    this.data().length > 0 && this.data().some((e) => e.count > 0)
  );

  @ViewChild('donutCanvas')
  donutCanvasRef!: ElementRef<HTMLCanvasElement>;

  private chart: Chart<'doughnut'> | null = null;

  /** Color map — order matches jury presentation priority */
  private readonly COLOR_MAP: Record<string, string> = {
    SIGNAL_RANGE: '#ff4444',
    TIMING_GAP:   '#ffaa00',
    DUPLICATE:    '#4488ff',
  };
  private readonly OTHER_COLOR = '#8b949e';

  constructor() {
    // React to data signal changes — update chart in place.
    effect(() => {
      const items = this.data();
      if (!this.chart || items.length === 0) return;
      this.chart.data.labels  = items.map((e) => e.type);
      this.chart.data.datasets[0].data             = items.map((e) => e.count);
      this.chart.data.datasets[0].backgroundColor  = items.map((e) => this.colorFor(e.type));
      this.chart.update('none');
    });
  }

  ngAfterViewInit(): void {
    // Delay one tick so @if(hasData()) renders the canvas first
    setTimeout(() => this.initChart(), 50);
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  colorFor(type: string): string {
    return this.COLOR_MAP[type] ?? this.OTHER_COLOR;
  }

  pct(count: number): number {
    const total = this.data().reduce((a, e) => a + e.count, 0);
    return total === 0 ? 0 : Math.round((count / total) * 100);
  }

  private initChart(): void {
    const canvas = this.donutCanvasRef?.nativeElement;
    if (!canvas) return;

    const items = this.data();
    if (items.length === 0) return;

    this.chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: items.map((e) => e.type),
        datasets: [{
          data: items.map((e) => e.count),
          backgroundColor: items.map((e) => this.colorFor(e.type)),
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverBorderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1f2937',
            titleColor: '#9ca3af',
            bodyColor: '#f3f4f6',
            borderColor: '#374151',
            borderWidth: 1,
            padding: 8,
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
}
