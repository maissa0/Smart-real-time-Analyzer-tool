import { Injectable } from '@angular/core';
import { Chart } from 'chart.js';

type UpdateMode = '' | 'none';

/**
 * Centralizes all Chart.js update() calls behind a single RAF loop.
 *
 * Callers register (chart, mode) via schedule(). The service coalesces
 * duplicate requests for the same chart instance — a full update ('') always
 * wins over 'none' so no downgrade can occur. On the next animation frame
 * the queue is drained and each chart is updated exactly once.
 *
 * This satisfies the architecture invariant: chart.update() is never called
 * synchronously from a WebSocket handler, Angular change detection, or any
 * other non-RAF path.
 */
@Injectable({ providedIn: 'root' })
export class ChartUpdateService {
  private readonly pending = new Map<Chart, UpdateMode>();
  private rafId: number | null = null;

  schedule(chart: Chart, mode: UpdateMode = 'none'): void {
    // Full update always wins — never downgrade a pending full update to 'none'
    if (this.pending.get(chart) !== '') {
      this.pending.set(chart, mode);
    }
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  private flush(): void {
    this.rafId = null;
    const batch = new Map(this.pending);
    this.pending.clear();
    batch.forEach((mode, chart) => {
      try {
        if (mode === '') {
          chart.update();
        } else {
          chart.update('none');
        }
      } catch {
        // chart was destroyed between schedule() and this RAF tick
      }
    });
  }
}
