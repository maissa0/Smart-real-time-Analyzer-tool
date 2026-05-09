import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, DecimalPipe } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { interval } from 'rxjs';
import { LiveTelemetryService } from '../../core/services/live-telemetry.service';
import { DashboardStore } from './dashboard.store';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DecimalPipe, HttpClientModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <span class="inline-block h-2 w-2 rounded-full"
            [class.bg-green-500]="liveTelemetry.connected()"
            [class.animate-pulse]="liveTelemetry.connected()"
            [class.bg-red-400]="!liveTelemetry.connected()">
          </span>
          WebSocket {{ liveTelemetry.connected() ? 'Connected' : 'Disconnected' }}
          <span class="ml-2 text-xs text-gray-400">
            Auto-refresh every 30s
          </span>
        </div>
      </div>

      <!-- Loading state -->
      @if (store.isLoading() && !store.stats()) {
        <div class="flex items-center justify-center py-20 text-gray-400">
          <svg class="animate-spin h-8 w-8 mr-3" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10"
              stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Loading dashboard data...
        </div>
      }

      <!-- Error state -->
      @if (store.error()) {
        <div class="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
          ⚠️ {{ store.error() }}
        </div>
      }

      <!-- KPI Cards -->
      @if (store.stats(); as stats) {
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">

          <!-- Sessions -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Sessions
            </p>
            <p class="mt-2 text-3xl font-bold text-gray-900">
              {{ stats.sessionCount | number }}
            </p>
            <p class="mt-1 text-xs text-gray-400">
              {{ stats.activeSessions }} live
            </p>
          </div>

          <!-- Total Frames -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Total Frames
            </p>
            <p class="mt-2 text-3xl font-bold text-gray-900">
              {{ stats.totalFrames | number }}
            </p>
            <p class="mt-1 text-xs text-gray-400">CAN frames in DB</p>
          </div>

          <!-- Faults -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Integrity Faults
            </p>
            <p class="mt-2 text-3xl font-bold"
              [class.text-red-600]="stats.totalFaults > 0"
              [class.text-green-600]="stats.totalFaults === 0">
              {{ stats.totalFaults | number }}
            </p>
            <p class="mt-1 text-xs text-gray-400">across all sessions</p>
          </div>

          <!-- Vehicles -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Vehicles
            </p>
            <p class="mt-2 text-3xl font-bold text-gray-900">
              {{ stats.totalCars }}
            </p>
            <p class="mt-1 text-xs text-gray-400">registered in fleet</p>
          </div>
        </div>

        <!-- Bottom row: Top Messages + Fault Breakdown + Recent Sessions -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">

          <!-- Top Message IDs -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <h2 class="text-sm font-semibold text-gray-700 mb-3">
              Top Message IDs
            </h2>
            <div class="space-y-2">
              @for (msg of stats.topMessageIds; track msg.msgId) {
                <div class="flex items-center justify-between text-sm">
                  <span class="font-mono text-gray-600">{{ msg.msgId }}</span>
                  <span class="text-gray-400">{{ msg.count | number }}</span>
                </div>
              }
              @if (stats.topMessageIds.length === 0) {
                <p class="text-xs text-gray-400">No frames yet</p>
              }
            </div>
          </div>

          <!-- Fault Breakdown -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <h2 class="text-sm font-semibold text-gray-700 mb-3">
              Fault Breakdown
            </h2>
            <div class="space-y-2">
              @for (entry of faultEntries(stats.faultsByType); track entry.type) {
                <div class="flex items-center justify-between text-sm">
                  <span class="text-gray-600">{{ entry.type }}</span>
                  <span class="font-medium"
                    [class.text-red-500]="entry.count > 0"
                    [class.text-gray-400]="entry.count === 0">
                    {{ entry.count | number }}
                  </span>
                </div>
              }
              @if (objectKeys(stats.faultsByType).length === 0) {
                <p class="text-xs text-green-600">No faults detected ✓</p>
              }
            </div>
          </div>

          <!-- Recent Sessions -->
          <div class="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <h2 class="text-sm font-semibold text-gray-700 mb-3">
              Recent Sessions
            </h2>
            <div class="space-y-2">
              @for (s of store.recentSessions(); track s.sessionId) {
                <div class="text-sm border-b border-gray-50 pb-2 last:border-0">
                  <p class="font-mono text-xs text-gray-500 truncate">
                    {{ s.sessionId }}
                  </p>
                  <p class="text-xs text-gray-400">
                    {{ s.frameCount | number }} frames
                    @if (s.sourceFilename) {
                      · {{ s.sourceFilename }}
                    }
                  </p>
                </div>
              }
              @if (store.recentSessions().length === 0) {
                <p class="text-xs text-gray-400">No sessions yet</p>
              }
            </div>
          </div>

        </div>
      }

    </div>
  `,
})
export class DashboardComponent implements OnInit {
  readonly liveTelemetry = inject(LiveTelemetryService);
  readonly store = inject(DashboardStore);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    // Initial load
    this.store.loadStats();

    // Poll every 30 seconds — auto-refresh KPI cards
    interval(30_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.store.loadStats());
  }

  /** Convert faultsByType Record to array for @for iteration */
  faultEntries(faultsByType: Record<string, number>): Array<{ type: string; count: number }> {
    return Object.entries(faultsByType).map(([type, count]) => ({ type, count }));
  }

  /** Expose Object.keys to template */
  objectKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj);
  }
}
