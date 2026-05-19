import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  QueryList,
  SimpleChanges,
  ViewChildren,
} from '@angular/core';

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Tooltip,
} from 'chart.js';

// Register Chart.js components needed for signal line charts.
// ArcElement and DoughnutController are registered in dashboard.component.ts.
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Tooltip,
);

export interface ChartDataset {
  signalName: string;
  color: string;
  points: { x: number; y: number; label: string }[];
}

interface MiniChart {
  signalName: string;
  color: string;
  chart: any;
  allLabels: Record<number, string>;
}

@Component({
  selector: 'app-signal-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-gray-900 rounded-xl p-4 border border-gray-700 w-full">
      <!-- Header -->
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-bold text-white tracking-wide">{{ groupTitle }}</span>
        <span class="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{{ msgName }}</span>
      </div>

      <!-- Mini charts — one per signal -->
      @for (ds of datasets; track ds.signalName; let i = $index; let last = $last) {
        <div class="mb-1">
          <!-- Signal name above chart -->
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="inline-block w-3 h-3 rounded-full flex-shrink-0" [style.background]="ds.color"></span>
            <span class="text-xs text-gray-400 font-mono">{{ ds.signalName }}</span>
            <span class="text-xs text-gray-500 ml-auto font-mono">{{ getLastLabel(ds) }}</span>
          </div>
          <!-- Canvas -->
          <canvas
            #chartCanvas
            [height]="last ? miniChartHeightBottom : miniChartHeight">
          </canvas>
        </div>
      }
    </div>
  `,
})
export class SignalChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChildren('chartCanvas') canvasRefs!: QueryList<ElementRef<HTMLCanvasElement>>;

  @Input() groupTitle = '';
  @Input() msgName = '';
  @Input() datasets: ChartDataset[] = [];
  @Input() chartHeight = 140; // kept for backward compat — not used directly
  @Input() miniChartHeight = 60; // height of each mini chart except last
  @Input() miniChartHeightBottom = 80; // height of bottom chart (more visible x axis)
  @Input() playheadTime = 0;

  private miniCharts: MiniChart[] = [];

  ngAfterViewInit(): void {
    this.initAllCharts();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.miniCharts.length) return;
    if (changes['datasets']) {
      this.updateAllCharts();
    }
    if (changes['playheadTime']) {
      this.miniCharts.forEach((mc) => mc.chart?.update('none'));
    }
  }

  ngOnDestroy(): void {
    this.miniCharts.forEach((mc) => mc.chart?.destroy());
    this.miniCharts = [];
  }

  getLastLabel(ds: ChartDataset): string {
    if (!ds.points.length) return '—';
    const last = ds.points[ds.points.length - 1];
    const labels = this.getMiniChart(ds.signalName)?.allLabels ?? {};
    return labels[last.y] ?? String(last.y);
  }

  updatePlayhead(time: number): void {
    this.playheadTime = time;
    this.miniCharts.forEach((mc) => mc.chart?.update('none'));
  }

  appendPoint(signalName: string, point: { x: number; y: number; label: string }): void {
    const dsIndex = this.datasets.findIndex((d) => d.signalName === signalName);
    if (dsIndex === -1) return;
    this.datasets[dsIndex].points.push(point);

    const mc = this.getMiniChart(signalName);
    if (!mc?.chart) return;

    if (point.label && !point.label.startsWith('raw:')) {
      mc.allLabels[point.y] = point.label.trim();
    }
    mc.chart.data.datasets[0].data.push(point as any);
  }

  flushUpdate(): void {
    this.miniCharts.forEach((mc) => mc.chart?.update('none'));
  }

  extendToTime(signalName: string, currentTime: number): void {
    const mc = this.getMiniChart(signalName);
    if (!mc?.chart) return;
    const data = mc.chart.data.datasets[0].data as any[];
    if (data.length === 0) return;
    const lastPoint = data[data.length - 1];
    if (lastPoint._phantom) data.pop();
    const lastReal = data[data.length - 1] as any;
    if (!lastReal) return;
    data.push({ x: currentTime, y: lastReal.y, label: lastReal.label, _phantom: true });
    mc.chart.update('none');
  }

  clear(): void {
    for (const ds of this.datasets) {
      ds.points = [];
    }
    this.miniCharts.forEach((mc) => {
      mc.allLabels = {};
      if (mc.chart) {
        mc.chart.data.datasets[0].data = [];
        mc.chart.update();
      }
    });
  }

  tickPlayhead(time: number): void {
    this.updatePlayhead(time);
  }

  private getMiniChart(signalName: string): MiniChart | undefined {
    return this.miniCharts.find((mc) => mc.signalName === signalName);
  }

  private getChartJs(): any {
    // Chart.js is now imported directly from node_modules.
    // (window as any)['Chart'] is no longer needed.
    return Chart;
  }

  private buildAllLabels(ds: ChartDataset): Record<number, string> {
    const labels: Record<number, string> = {};
    for (const pt of ds.points) {
      if (pt.label && pt.label.trim() !== '' && !pt.label.startsWith('raw:')) {
        labels[pt.y] = pt.label.trim();
      }
    }
    return labels;
  }

  private initAllCharts(): void {
    const Chart = this.getChartJs();
    if (!Chart) return;

    const canvases = this.canvasRefs.toArray();
    this.miniCharts = [];

    this.datasets.forEach((ds, i) => {
      const canvas = canvases[i];
      if (!canvas) return;
      const ctx = canvas.nativeElement.getContext('2d');
      if (!ctx) return;

      const allLabels = this.buildAllLabels(ds);
      const isLast = i === this.datasets.length - 1;

      const chart = new Chart(ctx, {
        type: 'line',
        
        data: {
          datasets: [
            {
              label: ds.signalName,
              data: ds.points.map((p) => ({ ...p })),
              borderColor: ds.color.length === 7 ? ds.color + 'CC' : ds.color,
              backgroundColor: ds.color + '20',
              borderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 6,
              pointBackgroundColor: ds.color.length === 7 ? ds.color + 'CC' : ds.color,
              fill: false,
              stepped: true,
              tension: 0,
            },
          ],
        },
        options: {
          responsive: true,
          animation: false,
          parsing: false,
          interaction: { mode: 'index', intersect: false },
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
                title: (items: any[]) => `t = ${items[0]?.parsed?.x?.toFixed(2)}s`,
                label: (ctx: any) => {
                  const rawPt = ctx.raw as any;
                  const y = rawPt?._phantom ? rawPt._realY ?? rawPt.y : rawPt?.y ?? 0;
                  const label = allLabels[Math.round(y)] ?? String(y);
                  return `  ${ds.signalName}: ${label}`;
                },
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              min: 0,
              ticks: {
                color: isLast ? '#9ca3af' : '#374151',
                font: { size: isLast ? 10 : 8 },
                maxTicksLimit: 8,
                callback: (value: unknown) => {
                  const v = Number(value);
                  if (v >= 60) {
                    const mins = Math.floor(v / 60);
                    const secs = Math.floor(v % 60);
                    return `${mins}m${secs.toString().padStart(2, '0')}s`;
                  }
                  return v % 1 === 0 ? `${v}s` : `${v.toFixed(1)}s`;
                },
              },
              grid: { color: isLast ? '#1f2937' : '#111827' },
              border: { color: '#374151' },
            },
            y: {
              type: 'linear',
              ticks: {
                color: '#6b7280',
                font: { size: 9 },
                stepSize: 1,
                maxTicksLimit: 4,
                callback: (value: unknown) => {
                  const n = Number(value);
                  const rounded = Math.round(n);
                  if (Math.abs(n - rounded) > 0.01) return '';
                  return allLabels[rounded] ?? rounded;
                },
              },
              grid: { color: '#1f2937' },
              border: { color: '#374151' },
              beginAtZero: true,
            },
          },
        },
      });

      this.miniCharts.push({ signalName: ds.signalName, color: ds.color, chart, allLabels });
    });
  }

  private updateAllCharts(): void {
    const Chart = this.getChartJs();
    if (!Chart) return;

    // If number of datasets changed, reinitialize
    if (this.miniCharts.length !== this.datasets.length) {
      this.miniCharts.forEach((mc) => mc.chart?.destroy());
      this.miniCharts = [];
      setTimeout(() => this.initAllCharts(), 0);
      return;
    }

    this.datasets.forEach((ds, i) => {
      const mc = this.miniCharts[i];
      if (!mc?.chart) return;
      mc.allLabels = this.buildAllLabels(ds);
      mc.chart.data.datasets[0].data = ds.points.map((p) => ({ ...p }));
      mc.chart.update();
    });
  }
}
