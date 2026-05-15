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
import { Router } from '@angular/router';
import { interval } from 'rxjs';
import { LiveTelemetryService } from '../../core/services/live-telemetry.service';
import { DashboardStore } from './dashboard.store';
import { KpiCardComponent } from './kpi-card/kpi-card.component';
import { MessageFrequencyChartComponent } from './message-frequency-chart/message-frequency-chart.component';
import { FaultDonutChartComponent, FaultEntry } from './fault-donut-chart/fault-donut-chart.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DecimalPipe, HttpClientModule, KpiCardComponent, MessageFrequencyChartComponent, FaultDonutChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div style="background:#07090b; min-height:100vh; padding:1.5rem; display:flex; flex-direction:column; gap:1.25rem;">

    <!-- Header -->
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <h1 style="font-size:1.5rem; font-weight:700; color:#fff; margin:0;">Dashboard</h1>
      <div style="display:flex; align-items:center; gap:0.75rem; font-size:0.78rem; color:#8a9ab0;">
        <span style="display:flex; align-items:center; gap:0.4rem;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%;"
            [style.background]="liveTelemetry.connected() ? '#2ea043' : '#ff4444'">
          </span>
          WebSocket {{ liveTelemetry.connected() ? 'Connected' : 'Disconnected' }}
        </span>
        <span style="border-left:1px solid #21262d; padding-left:0.75rem; font-size:0.72rem; color:#484f58;">
          Auto-refresh every 30s
        </span>
      </div>
    </div>

    <!-- Loading -->
    @if (store.isLoading() && !store.stats()) {
      <div style="display:flex; align-items:center; justify-content:center; padding:5rem 0; color:#484f58;">
        <svg style="width:24px; height:24px; margin-right:0.5rem; animation:spin 1s linear infinite;"
          fill="none" viewBox="0 0 24 24">
          <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        Loading dashboard data...
      </div>
    }

    <!-- Error -->
    @if (store.error()) {
      <div style="background:rgba(255,68,68,0.1); border:1px solid rgba(255,68,68,0.3);
        border-radius:8px; padding:1rem; color:#ff4444; font-size:0.82rem;">
        ⚠️ {{ store.error() }}
      </div>
    }

    @if (store.stats(); as stats) {

      <!-- KPI Cards -->
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:1rem;">
        <app-kpi-card label="Sessions"      [value]="stats.sessionCount"  [sub]="stats.activeSessions + ' live'"  [isLive]="stats.activeSessions > 0" />
        <app-kpi-card label="Total Frames"  [value]="stats.totalFrames"   sub="CAN frames in DB"                  [isLive]="liveTelemetry.connected()" />
        <app-kpi-card label="Integrity Faults" [value]="stats.totalFaults" sub="across all sessions"             [isLive]="false" />
        <app-kpi-card label="Vehicles"      [value]="stats.totalCars"     sub="registered in fleet"               [isLive]="false" />
      </div>

      <!-- Charts row -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
        <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:12px; padding:1.25rem;">
          <h2 style="font-size:0.78rem; font-weight:700; color:#8a9ab0; letter-spacing:0.08em; margin:0 0 1rem; text-transform:uppercase;">
            Top Message IDs
          </h2>
          @if (stats.topMessageIds.length > 0) {
            <app-message-frequency-chart [data]="stats.topMessageIds" />
          } @else {
            <p style="font-size:0.75rem; color:#484f58; text-align:center; padding:2rem 0;">No frames yet</p>
          }
        </div>
        <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:12px; padding:1.25rem;">
          <h2 style="font-size:0.78rem; font-weight:700; color:#8a9ab0; letter-spacing:0.08em; margin:0 0 1rem; text-transform:uppercase;">
            Fault Distribution
          </h2>
          <app-fault-donut-chart [data]="toFaultEntries(stats.faultsByType)" />
        </div>
      </div>

      <!-- Recent Sessions -->
      <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:12px; padding:1.25rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
          <h2 style="font-size:0.78rem; font-weight:700; color:#8a9ab0; letter-spacing:0.08em; margin:0; text-transform:uppercase;">
            Recent Sessions
          </h2>
          <button style="font-size:0.72rem; color:#b0ff44; background:none; border:none; cursor:pointer;"
            (click)="goTo('/admin/sniffer')">View All →</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.25rem;">
          @for (s of store.recentSessions(); track s.sessionId) {
            <div style="
              display:flex; align-items:center; justify-content:space-between;
              padding:0.75rem; border-radius:8px; cursor:pointer;
              border:1px solid transparent; transition:all 0.15s;"
              (click)="openSession(s.sessionId)"
              onmouseover="this.style.background='#161b22'; this.style.borderColor='rgba(176,255,68,0.1)'"
              onmouseout="this.style.background='transparent'; this.style.borderColor='transparent'">
              <div style="min-width:0;">
                <p style="font-family:monospace; font-size:0.72rem; color:#8a9ab0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                  {{ s.sessionId }}
                </p>
                @if (s.sourceFilename) {
                  <p style="font-size:0.68rem; color:#484f58; margin:0.15rem 0 0;">{{ s.sourceFilename }}</p>
                }
              </div>
              <div style="text-align:right; flex-shrink:0; margin-left:1rem;">
                <p style="font-size:0.75rem; font-weight:600; color:#e6edf3; margin:0;">
                  {{ s.frameCount | number }} frames
                </p>
                @if (s.createdAt) {
                  <p style="font-size:0.68rem; color:#484f58; margin:0.15rem 0 0;">
                    {{ formatDate(s.createdAt) }}
                  </p>
                }
              </div>
            </div>
          }
          @if (store.recentSessions().length === 0) {
            <p style="font-size:0.75rem; color:#484f58; text-align:center; padding:1.5rem 0;">No sessions yet</p>
          }
        </div>
      </div>

      <!-- Quick Actions -->
      <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:12px; padding:1.25rem;">
        <h2 style="font-size:0.78rem; font-weight:700; color:#8a9ab0; letter-spacing:0.08em; margin:0 0 1rem; text-transform:uppercase;">
          Quick Actions
        </h2>
        <div style="display:flex; flex-wrap:wrap; gap:0.75rem;">
          <button style="
            display:inline-flex; align-items:center; gap:0.5rem;
            background:#b0ff44; color:#07090b;
            border:none; border-radius:8px;
            padding:8px 18px; font-size:0.82rem; font-weight:700;
            cursor:pointer; transition:opacity 0.2s;"
            onmouseover="this.style.opacity='0.85'"
            onmouseout="this.style.opacity='1'"
            (click)="goTo('/admin/simulator')">
            <svg style="width:15px; height:15px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Start Simulator
          </button>
          <button style="
            display:inline-flex; align-items:center; gap:0.5rem;
            background:transparent; color:#8a9ab0;
            border:1px solid #30363d; border-radius:8px;
            padding:8px 18px; font-size:0.82rem;
            cursor:pointer; transition:all 0.2s;"
            onmouseover="this.style.borderColor='rgba(176,255,68,0.3)'; this.style.color='#b0ff44'"
            onmouseout="this.style.borderColor='#30363d'; this.style.color='#8a9ab0'"
            (click)="goTo('/admin/upload')">
            <svg style="width:15px; height:15px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Upload Log
          </button>
          <button style="
            display:inline-flex; align-items:center; gap:0.5rem;
            background:transparent; color:#8a9ab0;
            border:1px solid #30363d; border-radius:8px;
            padding:8px 18px; font-size:0.82rem;
            cursor:pointer; transition:all 0.2s;"
            onmouseover="this.style.borderColor='rgba(176,255,68,0.3)'; this.style.color='#b0ff44'"
            onmouseout="this.style.borderColor='#30363d'; this.style.color='#8a9ab0'"
            (click)="goTo('/admin/monitor')">
            <svg style="width:15px; height:15px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
            Live Monitor
          </button>
          <button style="
            display:inline-flex; align-items:center; gap:0.5rem;
            background:transparent; color:#8a9ab0;
            border:1px solid #30363d; border-radius:8px;
            padding:8px 18px; font-size:0.82rem;
            cursor:pointer; transition:all 0.2s;"
            onmouseover="this.style.borderColor='rgba(176,255,68,0.3)'; this.style.color='#b0ff44'"
            onmouseout="this.style.borderColor='#30363d'; this.style.color='#8a9ab0'"
            (click)="goTo('/admin/fleet')">
            <svg style="width:15px; height:15px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
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

    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </div>
`,
})
export class DashboardComponent implements OnInit {
  readonly liveTelemetry = inject(LiveTelemetryService);
  readonly store         = inject(DashboardStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router     = inject(Router);

  ngOnInit(): void {
    this.store.loadStats();
    interval(30_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.store.loadStats());
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

  /** Convert faultsByType Record to FaultEntry[] for FaultDonutChartComponent */
  toFaultEntries(faultsByType: Record<string, number>): FaultEntry[] {
    return Object.entries(faultsByType).map(([type, count]) => ({
      type,
      count,
    }));
  }
}
