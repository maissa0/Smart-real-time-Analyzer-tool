import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { Subscription } from 'rxjs';
import { LiveTelemetryService } from '../../core/services/live-telemetry.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-[60vh] flex-col items-center justify-center gap-6">

      <!-- Connection Status Card -->
      <div class="flex items-center gap-3 rounded-xl border border-able-border bg-white px-6 py-4 shadow-able-card">
        <span
          class="inline-block h-3 w-3 rounded-full"
          [ngClass]="{
            'bg-green-500 animate-pulse': liveTelemetry.connected(),
            'bg-red-500': !liveTelemetry.connected()
          }"
        ></span>
        <span class="text-sm font-medium text-gray-700">
          WebSocket:
          <span
            [ngClass]="{
              'text-green-600': liveTelemetry.connected(),
              'text-red-500': !liveTelemetry.connected()
            }"
          >
            {{ liveTelemetry.connected() ? 'CONNECTED' : 'DISCONNECTED' }}
          </span>
        </span>
        <span class="text-xs text-gray-400">
          Frames received: {{ liveTelemetry.frameCount() }}
        </span>
      </div>

      <!-- Dashboard Coming Soon Card -->
      <div class="flex flex-col items-center rounded-2xl border border-able-border bg-white px-12 py-16 shadow-able-card">
        <div class="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-able-primary/10">
          <svg class="h-10 w-10 text-able-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-gray-900">Coming Soon</h1>
        <p class="mt-2 max-w-sm text-center text-gray-500">
          The dashboard is under construction. We're building something great — check back soon.
        </p>
        <div class="mt-8 flex items-center gap-2 text-sm text-gray-400">
          <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-able-primary"></span>
          <span>In development</span>
        </div>
      </div>

    </div>
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly liveTelemetry = inject(LiveTelemetryService);

  private signalSub: Subscription | null = null;

  ngOnInit(): void {
    // Don't connect/disconnect — just observe existing connection state
    // The sniffer manages the actual WebSocket connection

    // Subscribe to Engine_RPM_High signal and log to console
    this.signalSub = this.liveTelemetry
      .getSignalStream('Engine_RPM_High')
      .subscribe(value => {
        console.log(`[Dashboard] Engine_RPM_High: ${value}`);
      });
  }

  ngOnDestroy(): void {
    this.signalSub?.unsubscribe();
    // Never disconnect here — sniffer manages the connection
  }
}
