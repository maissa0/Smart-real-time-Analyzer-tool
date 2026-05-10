import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  input,
} from '@angular/core';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
} from 'chart.js';

// Register Chart.js components for bar chart.
// LineController etc. are registered in signal-chart.component.ts.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export interface MsgFrequency {
  msgId: string;
  count: number;
}

/**
 * Standalone bar chart component — Top Message IDs by frame count.
 * Input: data signal with array of { msgId, count }.
 * Colors: #b0ff44 at 70% opacity, full color on hover.
 * No legend — x-axis labels are the message IDs.
 *
 * Usage:
 * <app-message-frequency-chart [data]="stats.topMessageIds" />
 */
@Component({
  selector: 'app-message-frequency-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; width: 100%; }
    .chart-wrap {
      position: relative;
      width: 100%;
      height: 250px;
    }
    canvas {
      width: 100% !important;
      height: 100% !important;
    }
  `],
  template: `
    <div class="chart-wrap">
      <canvas #barCanvas></canvas>
    </div>
  `,
})
export class MessageFrequencyChartComponent
  implements AfterViewInit, OnDestroy {

  /** Signal input — array of { msgId, count } from dashboard stats. */
  readonly data = input<MsgFrequency[]>([]);

  @ViewChild('barCanvas')
  barCanvasRef!: ElementRef<HTMLCanvasElement>;

  private chart: Chart<'bar'> | null = null;

  constructor() {
    // React to data signal changes — update chart in place.
    effect(() => {
      const items = this.data();
      if (this.chart && items.length > 0) {
        this.chart.data.labels = items.map((d) => d.msgId);
        this.chart.data.datasets[0].data = items.map((d) => d.count);
        this.chart.update('none'); // no animation on auto-refresh
      }
    });
  }

  ngAfterViewInit(): void {
    this.initChart();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  private initChart(): void {
    const canvas = this.barCanvasRef?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const items = this.data();

    this.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: items.map((d) => d.msgId),
        datasets: [
          {
            label: 'Frames',
            data: items.map((d) => d.count),
            // #b0ff44 at 70% opacity — KPIT brand green
            backgroundColor: 'rgba(176, 255, 68, 0.70)',
            hoverBackgroundColor: '#b0ff44',
            borderColor: 'rgba(176, 255, 68, 0.9)',
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
              label: (ctx) =>
                ` ${(ctx.raw as number).toLocaleString()} frames`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#6b7280',
              font: { size: 11, family: 'monospace' },
            },
            grid: { display: false },
            border: { color: '#e5e7eb' },
          },
          y: {
            ticks: {
              color: '#9ca3af',
              font: { size: 10 },
              callback: (value) => {
                const v = Number(value);
                if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
                return String(v);
              },
            },
            grid: { color: '#f3f4f6' },
            border: { color: '#e5e7eb' },
            beginAtZero: true,
          },
        },
      },
    });
  }
}
