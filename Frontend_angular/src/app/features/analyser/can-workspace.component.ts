import {
  ChangeDetectionStrategy, Component, OnInit,
  inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { Router, ActivatedRoute } from '@angular/router';
import { API_BASE_URL } from '../../core/config/api.config';
import { SnifferComponent } from '../sniffer/sniffer.component';
import { SimulatorControlComponent } from '../sniffer/simulator/simulator-control.component';

interface Car {
  carUid: string; make: string; model: string;
  year: number; isVirtual: boolean;
}
interface Session {
  sessionId: string; sourceFilename: string | null;
  frameCount: number | null; createdAt: string | null;
  status: string | null;
}

@Component({
  selector: 'app-can-workspace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, HttpClientModule, SnifferComponent, SimulatorControlComponent],
  styles: [`
    :host { display:block; height:100vh; overflow:hidden; }

    .workspace {
      display: flex; flex-direction: column;
      height: 100vh; background: #07090b; overflow: hidden;
    }

    /* ── Top bar ── */
    .topbar {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0 1.25rem; height: 52px;
      background: #0d1117;
      border-bottom: 1px solid rgba(176,255,68,0.10);
      flex-shrink: 0;
    }
    .topbar-logo {
      display: flex; align-items: center; gap: 0.5rem;
    }
    .topbar-logo span {
      font-size: 0.9rem; font-weight: 700;
      color: #fff; letter-spacing: 0.05em;
    }
    .topbar-sep { width:1px; height:20px; background:#21262d; }
    .vehicle-select {
      background: #161b22;
      border: 1px solid rgba(176,255,68,0.20);
      border-radius: 6px; color: #e6edf3;
      font-size: 0.78rem; padding: 5px 10px;
      outline: none; cursor: pointer;
    }
    .vehicle-select:focus { border-color: rgba(176,255,68,0.5); }
    .session-count {
      font-size: 0.68rem; color: #484f58;
    }
    .topbar-actions { margin-left: auto; display:flex; align-items:center; gap:0.5rem; }
    .ws-indicator {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.68rem; color: #484f58;
    }
    .ws-dot { width:6px; height:6px; border-radius:50%; }
    .panel-toggle {
      display: flex; align-items: center; gap: 0.4rem;
      padding: 5px 12px; border-radius: 6px;
      border: 1px solid #30363d; background: transparent;
      color: #8a9ab0; font-size: 0.72rem; cursor: pointer;
      transition: all 0.2s;
    }
    .panel-toggle:hover { border-color: rgba(176,255,68,0.3); color: #b0ff44; }

    /* ── Body ── */
    .body { display:flex; flex:1; overflow:hidden; }

    /* ── Left panel ── */
    .left-panel {
      width: 290px; flex-shrink: 0;
      background: #0d1117;
      border-right: 1px solid rgba(176,255,68,0.08);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .lp-block {
      padding: 1rem;
      border-bottom: 1px solid #161b22;
    }
    .lp-block-flex {
      padding: 1rem;
      border-bottom: 1px solid #161b22;
      flex: 1; overflow-y: auto;
    }
    .block-label {
      font-size: 0.6rem; font-weight: 700;
      letter-spacing: 0.16em; color: #b0ff44;
      text-transform: uppercase;
      display: flex; align-items: center; justify-content: space-between;
      margin: 0 0 0.75rem;
    }
    .block-label-count { color: #484f58; font-weight: 400; }

    /* Session list */
    .session-list {
      display: flex; flex-direction: column;
      gap: 0.25rem; max-height: 260px; overflow-y: auto;
    }
    .session-list::-webkit-scrollbar { width: 3px; }
    .session-list::-webkit-scrollbar-thumb { background: #21262d; border-radius:2px; }
    .session-row {
      padding: 0.55rem 0.7rem; border-radius: 7px;
      cursor: pointer; border: 1px solid transparent;
      transition: all 0.12s;
    }
    .session-row:hover { background: #161b22; }
    .session-row.selected {
      background: rgba(176,255,68,0.07);
      border-color: rgba(176,255,68,0.22);
    }
    .session-row-top {
      display: flex; align-items: center; gap: 0.45rem;
    }
    .s-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
    .s-name {
      font-size: 0.73rem; color: #e6edf3; font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .session-row-meta {
      display: flex; justify-content: space-between;
      margin-top: 0.18rem; padding-left: 1rem;
    }
    .s-meta { font-size: 0.6rem; color: #484f58; }
    .empty-list {
      font-size: 0.72rem; color: #484f58;
      text-align: center; padding: 1rem 0; margin: 0;
    }

    /* Actions */
    .action-btn {
      display: flex; align-items: center; justify-content: center;
      gap: 0.45rem; width: 100%; padding: 8px;
      border-radius: 7px; font-size: 0.74rem;
      cursor: pointer; transition: all 0.18s;
    }
    .action-btn-upload {
      border: 1px dashed rgba(176,255,68,0.22);
      background: transparent; color: #8a9ab0;
    }
    .action-btn-upload:hover {
      border-color: rgba(176,255,68,0.5); color: #b0ff44;
    }
    .action-btn-sim {
      border: 1px solid rgba(176,255,68,0.18);
      background: transparent; color: #8a9ab0;
      margin-top: 0.45rem;
    }
    .action-btn-sim:hover {
      border-color: rgba(176,255,68,0.45); color: #b0ff44;
    }
    .sim-expanded {
      margin-top: 0.6rem;
      background: #161b22;
      border: 1px solid rgba(176,255,68,0.1);
      border-radius: 8px; padding: 0.75rem;
    }

    /* Filters */
    .filter-row { display:flex; flex-direction:column; gap:0.65rem; }
    .filter-field { display:flex; flex-direction:column; gap:0.28rem; }
    .filter-field-label { font-size:0.62rem; color:#484f58; }
    .filter-select {
      width: 100%; background: #161b22;
      border: 1px solid rgba(176,255,68,0.1);
      border-radius: 5px; color: #e6edf3;
      font-size: 0.73rem; padding: 4px 7px; outline: none;
    }
    .filter-select:focus { border-color: rgba(176,255,68,0.35); }
    .fault-toggle {
      padding: 4px 10px; border-radius: 5px;
      font-size: 0.67rem; font-weight: 600;
      border: 1px solid; cursor: pointer;
      transition: all 0.15s; align-self: flex-start;
    }

    /* ── Right panel ── */
    .right-panel {
      flex: 1; overflow: hidden;
      display: flex; flex-direction: column;
    }
    .empty-state {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 0.85rem; color: #484f58;
    }
    .empty-state-icon { opacity: 0.25; }
    .empty-state p { margin:0; font-size:0.88rem; }
    .empty-state small { font-size:0.72rem; color:#30363d; }
    .sniffer-host { flex:1; overflow:hidden; display:flex; flex-direction:column; }
    .sniffer-host ::ng-deep .kpit-sniffer-layout { height:100%; }
  `],
  template: `
    <div class="workspace">

      <!-- ══ TOP BAR ══ -->
      <header class="topbar">
        <div class="topbar-logo">
          <svg width="17" height="17" fill="none" stroke="#b0ff44" stroke-width="2" viewBox="0 0 24 24">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
          <span>CAN WORKSPACE</span>
        </div>

        <div class="topbar-sep"></div>

        <!-- Vehicle filter -->
        <select class="vehicle-select" (change)="onVehicleChange($any($event.target).value)">
          <option value="">All Vehicles</option>
          @for (car of cars(); track car.carUid) {
            <option [value]="car.carUid">
              {{ car.make }} {{ car.model }} {{ car.year }}
              {{ car.isVirtual ? ' (virtual)' : '' }}
            </option>
          }
        </select>

        @if (selectedVehicleUid()) {
          <span class="session-count">{{ sessions().length }} sessions</span>
        }

        <div class="topbar-actions">
          <span class="ws-indicator">
            <span class="ws-dot"
              [style.background]="connected() ? '#b0ff44' : '#ff4444'">
            </span>
            {{ connected() ? 'Live' : 'Offline' }}
          </span>
          <button class="panel-toggle" (click)="panelOpen.set(!panelOpen())">
            {{ panelOpen() ? '◀ Hide' : '▶ Show' }}
          </button>
        </div>
      </header>

      <!-- ══ BODY ══ -->
      <div class="body">

        <!-- ══ LEFT PANEL ══ -->
        @if (panelOpen()) {
          <aside class="left-panel">

            <!-- Sessions -->
            <div class="lp-block">
              <p class="block-label">
                Sessions
                <span class="block-label-count">{{ sessions().length }}</span>
              </p>
              <div class="session-list">
                @for (s of sessions(); track s.sessionId) {
                  <div class="session-row"
                    [class.selected]="activeSessionId() === s.sessionId"
                    (click)="openSession(s.sessionId)">
                    <div class="session-row-top">
                      <span class="s-dot"
                        [style.background]="
                          s.status === 'LIVE'     ? '#b0ff44' :
                          s.status === 'COMPLETE' ? '#3fb950' :
                          s.status === 'ERROR'    ? '#ff4444' : '#484f58'">
                      </span>
                      <span class="s-name">
                        {{ s.sourceFilename || s.sessionId }}
                      </span>
                    </div>
                    <div class="session-row-meta">
                      <span class="s-meta">{{ s.frameCount | number }} frames</span>
                      <span class="s-meta">{{ s.createdAt | slice:0:10 }}</span>
                    </div>
                  </div>
                }
                @if (sessions().length === 0 && !loading()) {
                  <p class="empty-list">No sessions{{ selectedVehicleUid() ? ' for this vehicle' : '' }}</p>
                }
                @if (loading()) {
                  <p class="empty-list">Loading...</p>
                }
              </div>
            </div>

            <!-- New session -->
            <div class="lp-block" style="overflow-y:auto; max-height:calc(100vh - 320px);">
              <p class="block-label">New Session</p>

              <label class="action-btn action-btn-upload">
                <input type="file" accept=".asc,.blf,.log,.txt"
                  style="display:none" (change)="uploadFile($event)"/>
                <svg width="13" height="13" fill="none" stroke="currentColor"
                  stroke-width="2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload Log File
              </label>

              <button class="action-btn action-btn-sim"
                (click)="simOpen.set(!simOpen())">
                <svg width="13" height="13" fill="none" stroke="currentColor"
                  stroke-width="2" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                {{ simOpen() ? 'Hide Simulator' : 'Start Simulator' }}
              </button>

              @if (simOpen()) {
                <div class="sim-expanded">
                  <app-simulator-control
                    (simulatorStarted)="onSimulatorStarted()"
                    (simulatorStopped)="onSimulatorStopped()">
                  </app-simulator-control>
                </div>
              }
            </div>

            <!-- Filters -->
            @if (activeSessionId()) {
              <div class="lp-block-flex">
                <p class="block-label">Filters</p>
                <div class="filter-row">
                  <div class="filter-field">
                    <label class="filter-field-label">Message ID</label>
                    <select class="filter-select">
                      <option value="">All</option>
                    </select>
                  </div>
                  <div class="filter-field">
                    <label class="filter-field-label">Bus / Channel</label>
                    <select class="filter-select">
                      <option value="">All</option>
                    </select>
                  </div>
                  <button class="fault-toggle"
                    [style.background]="faultsOnly() ? 'rgba(255,170,0,0.1)' : 'transparent'"
                    [style.borderColor]="faultsOnly() ? '#ffaa00' : '#30363d'"
                    [style.color]="faultsOnly() ? '#ffaa00' : '#8a9ab0'"
                    (click)="faultsOnly.set(!faultsOnly())">
                    ⚠ Faults only
                  </button>
                </div>
              </div>
            }

          </aside>
        }

        <!-- ══ RIGHT PANEL ══ -->
        <main class="right-panel">

          @if (!activeSessionId()) {
            <div class="empty-state">
              <svg class="empty-state-icon" width="52" height="52" fill="none"
                stroke="#8a9ab0" stroke-width="1" viewBox="0 0 24 24">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              <p>Select a session to begin analysis</p>
              <small>or upload a log file / start the simulator from the left panel</small>
            </div>
          } @else {
            <div class="sniffer-host">
              <app-sniffer
                [hideUpload]="true"
                [hideSimulator]="true"
                [autoSelectSessionId]="activeSessionId() ?? undefined"
                style="display:block; height:100%;">
              </app-sniffer>
            </div>
          }

        </main>
      </div>
    </div>
  `,
})
export class CanWorkspaceComponent implements OnInit {
  private readonly http  = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route  = inject(ActivatedRoute);

  readonly cars             = signal<Car[]>([]);
  readonly sessions         = signal<Session[]>([]);
  readonly activeSessionId  = signal<string | null>(null);
  readonly selectedVehicleUid = signal<string>('');
  readonly panelOpen        = signal(true);
  readonly simOpen          = signal(false);
  readonly loading          = signal(false);
  readonly faultsOnly       = signal(false);
  readonly connected        = signal(false);

  ngOnInit(): void {
    this.loadCars();
    this.loadSessions('');
    this.route.queryParams.subscribe(p => {
      if (p['sessionId']) this.activeSessionId.set(p['sessionId']);
    });
  }

  onVehicleChange(uid: string): void {
    this.selectedVehicleUid.set(uid);
    this.activeSessionId.set(null);
    this.loadSessions(uid);
  }

  openSession(id: string): void {
    this.activeSessionId.set(this.activeSessionId() === id ? null : id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sessionId: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  uploadFile(e: Event): void {
    this.router.navigate(['/admin/upload']);
  }

  onSimulatorStarted(): void {
    this.simOpen.set(false); // collapse simulator panel
    // After 3s — session should be in MySQL, auto-select it
    setTimeout(() => {
      this.loadSessions(this.selectedVehicleUid());
      setTimeout(() => {
        // Find the newest live_simulation session and auto-select it
        const liveSession = this.sessions().find(
          s => s.sourceFilename === 'live_simulation' && s.status !== 'COMPLETE'
        );
        if (liveSession) {
          this.openSession(liveSession.sessionId);
        }
      }, 500);
    }, 3000);
    // Keep refreshing every 5s while simulator runs
    const interval = setInterval(() => {
      this.loadSessions(this.selectedVehicleUid());
    }, 5000);
    (this as any)._simInterval = interval;
  }

  onSimulatorStopped(): void {
    if ((this as any)._simInterval) {
      clearInterval((this as any)._simInterval);
      (this as any)._simInterval = null;
    }
    // Refresh session list multiple times to catch status=COMPLETE update
    setTimeout(() => this.loadSessions(this.selectedVehicleUid()), 1000);
    setTimeout(() => this.loadSessions(this.selectedVehicleUid()), 3000);
    setTimeout(() => this.loadSessions(this.selectedVehicleUid()), 6000);
  }

  private h(): HttpHeaders {
    const t = localStorage.getItem('access_token');
    return t ? new HttpHeaders({ Authorization: `Bearer ${t}` }) : new HttpHeaders();
  }

  loadCars(): void {
    this.http.get<Car[]>(`${API_BASE_URL}/api/cars`, { headers: this.h() })
      .subscribe({ next: c => this.cars.set(c), error: () => {} });
  }

  loadSessions(uid: string): void {
    this.loading.set(true);
    const url = uid
      ? `${API_BASE_URL}/api/cars/${uid}/sessions`
      : `${API_BASE_URL}/api/can/sessions`;
    this.http.get<Session[]>(url, { headers: this.h() })
      .subscribe({
        next: s => { this.sessions.set(s); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
  }
}
