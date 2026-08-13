import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subject, takeUntil } from 'rxjs';
import { CanService } from '../../../core/services/can.service';
import { LiveTelemetryService } from '../../../core/services/live-telemetry.service';
import { CanSession } from '../../../core/models/can.model';
import { SimulatorControlComponent } from '../../sniffer/simulator/simulator-control.component';
import { LogUploadComponent } from '../../sniffer/upload/log-upload.component';
import { NlAskComponent } from '../../../shared/components/nl-ask/nl-ask.component';

type SortKey = 'newest' | 'oldest' | 'most-frames';

@Component({
  selector: 'app-workspace-sessions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, SimulatorControlComponent, LogUploadComponent, NlAskComponent],
  styles: [`
    :host { display: block; height: 100%; background: #07090b; overflow-y: auto; }

    .page { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }

    .action-bar {
      display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap;
    }
    .btn-action {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.55rem 1.1rem; border-radius: 8px; font-size: 0.82rem; font-weight: 600;
      cursor: pointer; transition: all 0.18s; border: 1px solid rgba(176,255,68,0.3);
      background: transparent; color: #b0ff44;
    }
    .btn-action:hover { background: rgba(176,255,68,0.08); border-color: #b0ff44; }
    .btn-action.active { background: rgba(176,255,68,0.15); border-color: #b0ff44; }
    .btn-action.running { background: rgba(176,255,68,0.08); border-color: #b0ff44; color: #b0ff44; cursor: not-allowed; }
    .btn-action:disabled { opacity: 0.85; }
    .search-input {
      margin-left: auto; background: #161b22; border: 1px solid rgba(176,255,68,0.2);
      border-radius: 8px; color: #e6edf3; font-size: 0.82rem; padding: 0.5rem 0.9rem;
      outline: none; width: 220px;
    }
    .search-input:focus { border-color: rgba(176,255,68,0.5); }
    .search-input::placeholder { color: #484f58; }

    .inline-panel {
      background: #0d1117; border: 1px solid rgba(176,255,68,0.12); border-radius: 12px;
      padding: 1.25rem; margin-bottom: 1.5rem;
    }

    .section-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.9rem;
    }
    .section-title {
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #8a9ab0;
    }
    .sort-select {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      color: #8a9ab0; font-size: 0.72rem; padding: 4px 8px; outline: none; cursor: pointer;
    }

    .session-card {
      display: flex; align-items: center; gap: 1rem;
      background: #0d1117; border: 1px solid rgba(176,255,68,0.08); border-radius: 10px;
      padding: 0.9rem 1.1rem; margin-bottom: 0.6rem; cursor: pointer; transition: all 0.18s;
    }
    .session-card:hover { border-color: rgba(176,255,68,0.25); background: #0f1419; }
    .session-card.live { border-color: rgba(176,255,68,0.3); background: rgba(176,255,68,0.02); }

    .status-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.live { background: #b0ff44; box-shadow: 0 0 8px #b0ff44; animation: pulse 1.4s infinite; }
    .status-dot.complete { background: #3fb950; }
    .status-dot.error { background: #ff4444; }
    .status-dot.other { background: #484f58; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

    .card-main { flex: 1; min-width: 0; }
    .card-name { font-size: 0.88rem; font-weight: 600; color: #e6edf3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card-meta { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.3rem; flex-wrap: wrap; }
    .card-meta-item { font-size: 0.68rem; color: #8a9ab0; }

    .card-badges { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
    .badge {
      font-size: 0.65rem; font-weight: 600; padding: 2px 7px; border-radius: 4px; white-space: nowrap;
    }
    .badge.frames { background: rgba(176,255,68,0.12); color: #b0ff44; }

    .btn-inspect {
      padding: 0.4rem 0.85rem; border-radius: 6px; font-size: 0.72rem; font-weight: 600;
      border: 1px solid rgba(176,255,68,0.3); background: transparent; color: #b0ff44;
      cursor: pointer; transition: all 0.18s; white-space: nowrap; flex-shrink: 0;
    }
    .btn-inspect:hover { background: rgba(176,255,68,0.1); border-color: #b0ff44; }

    .live-section { margin-bottom: 1.5rem; }

    .load-more {
      display: block; width: 100%; margin-top: 1rem; padding: 0.6rem;
      border: 1px dashed rgba(176,255,68,0.2); border-radius: 8px;
      background: transparent; color: #8a9ab0; font-size: 0.78rem; cursor: pointer;
      transition: all 0.18s; text-align: center;
    }
    .load-more:hover { border-color: rgba(176,255,68,0.4); color: #b0ff44; }

    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 1.5rem; padding: 5rem 2rem; text-align: center;
    }
    .empty-icon { font-size: 3rem; opacity: 0.25; }
    .empty-title { font-size: 1.1rem; font-weight: 600; color: #e6edf3; }
    .empty-sub { font-size: 0.82rem; color: #8a9ab0; max-width: 380px; line-height: 1.6; }
    .empty-actions { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; }
    .btn-primary {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.65rem 1.4rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
      background: #b0ff44; color: #07090b; border: none; cursor: pointer; transition: opacity 0.18s;
    }
    .btn-primary:hover { opacity: 0.85; }
    .btn-secondary {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.65rem 1.4rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
      background: transparent; color: #e6edf3; border: 1px solid #30363d; cursor: pointer; transition: all 0.18s;
    }
    .btn-secondary:hover { border-color: rgba(176,255,68,0.3); color: #b0ff44; }

    .spinner {
      width: 22px; height: 22px; border: 2px solid #21262d; border-top-color: #b0ff44;
      border-radius: 50%; animation: spin 0.8s linear infinite; margin: 3rem auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
  template: `
    <div class="page">

      <!-- Action bar -->
      <div class="action-bar">
        <button class="btn-action"
                [class.active]="showSimulator()"
                [class.running]="simulatorRunning()"
                [disabled]="simulatorRunning()"
                (click)="togglePanel('simulator')">
          {{ simulatorRunning() ? '● Simulator Running' : '▶ Start Simulator' }}
        </button>
        <button class="btn-action" [class.active]="showUpload()"
                (click)="togglePanel('upload')">
          📁 Upload Log File
        </button>
        <input class="search-input" type="text" placeholder="Search sessions…"
               [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)" />
      </div>

      <!-- Natural-language ask over sessions/cars/faults -->
      <div class="inline-panel" style="padding: 0.8rem 1rem;">
        <app-nl-ask placeholder="Ask about your sessions — e.g. 'sessions from last week with faults' or 'longest session per car'" />
      </div>

      <!-- Inline simulator panel -->
      @if (showSimulator()) {
        <div class="inline-panel">
          <app-simulator-control
            (simulatorStarted)="onSimulatorStarted()"
            (simulatorStopped)="onSimulatorStopped()" />
        </div>
      }

      <!-- Inline upload panel -->
      @if (showUpload()) {
        <div class="inline-panel">
          <app-log-upload (uploadComplete)="onUploadComplete($event)" />
        </div>
      }

      @if (loading()) {
        <div class="spinner"></div>
      } @else if (liveSessions().length === 0 && completedSessions().length === 0) {
        <div class="empty-state">
          <div class="empty-icon">📡</div>
          <div class="empty-title">No sessions yet</div>
          <div class="empty-sub">
            Start the CAN simulator to generate synthetic frames in real time,
            or upload a recorded log file to analyse offline.
          </div>
          <div class="empty-actions">
            <button class="btn-primary" (click)="togglePanel('simulator')">▶ Start Simulator</button>
            <button class="btn-secondary" (click)="togglePanel('upload')">📁 Upload Log File</button>
          </div>
        </div>
      } @else {

        <!-- Live sessions -->
        @if (liveSessions().length > 0) {
          <div class="live-section">
            <div class="section-header">
              <span class="section-title">● Active Now</span>
            </div>
            @for (s of liveSessions(); track s.sessionId) {
              <div class="session-card live" (click)="inspect(s.sessionId)">
                <div class="status-dot live"></div>
                <div class="card-main">
                  <div class="card-name">{{ displayName(s) }}</div>
                  <div class="card-meta">
                    <span class="card-meta-item">{{ liveTelemetry.frameCount() | number }} frames</span>
                    <span class="card-meta-item">{{ s.createdAt | date:'HH:mm' }}</span>
                  </div>
                </div>
                <div class="card-badges">
                  <span class="badge frames">LIVE</span>
                </div>
                <button class="btn-inspect" (click)="$event.stopPropagation(); inspect(s.sessionId)">
                  Inspect →
                </button>
              </div>
            }
          </div>
        }

        <!-- Completed sessions -->
        @if (completedSessions().length > 0) {
          <div class="section-header">
            <span class="section-title">Completed — {{ completedSessions().length }}</span>
            <select class="sort-select" [ngModel]="sortBy()" (ngModelChange)="sortBy.set($event)">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="most-frames">Most frames</option>
            </select>
          </div>
          @for (s of completedSessions(); track s.sessionId) {
            <div class="session-card" (click)="inspect(s.sessionId)">
              <div class="status-dot" [class]="dotClass(s)"></div>
              <div class="card-main">
                <div class="card-name">{{ displayName(s) }}</div>
                <div class="card-meta">
                  <span class="card-meta-item">{{ s.frameCount | number }} frames</span>
                  <span class="card-meta-item">{{ s.createdAt | date:'d MMM, HH:mm' }}</span>
                  @if (duration(s); as d) {
                    <span class="card-meta-item">{{ d }}</span>
                  }
                  <span class="card-meta-item" style="color:#484f58;">{{ s.status }}</span>
                </div>
              </div>
              <div class="card-badges">
                <span class="badge frames">{{ s.frameCount | number }} fr</span>
              </div>
              <button class="btn-inspect" (click)="$event.stopPropagation(); inspect(s.sessionId)">
                Inspect →
              </button>
            </div>
          }
        }

        @if (hasMore()) {
          <button class="load-more" (click)="loadMore()" [disabled]="loadingMore()">
            {{ loadingMore() ? 'Loading…' : 'Load more sessions ↓' }}
          </button>
        }
      }
    </div>
  `,
})
export class WorkspaceSessionsComponent implements OnInit, OnDestroy {
  private canService = inject(CanService);
  readonly liveTelemetry = inject(LiveTelemetryService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  sessions = signal<CanSession[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  hasMore = signal(false);
  currentPage = signal(0);
  readonly pageSize = 20;

  searchQuery = signal('');
  sortBy = signal<SortKey>('newest');
  showSimulator = signal(false);
  showUpload = signal(false);
  simulatorRunning = signal(false);

  private readonly stopPolling$ = new Subject<void>();

  liveSessions = computed(() =>
    this.sessions().filter((s) => !s.status || s.status.toUpperCase() === 'LIVE')
  );

  completedSessions = computed(() => {
    const q = this.searchQuery().toLowerCase();
    let list = this.sessions()
      .filter((s) => !!s.status && s.status.toUpperCase() !== 'LIVE')
      .filter((s) => !q || this.displayName(s).toLowerCase().includes(q));

    const key = this.sortBy();
    if (key === 'newest') {
      list = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (key === 'oldest') {
      list = [...list].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (key === 'most-frames') {
      list = [...list].sort((a, b) => (b.frameCount ?? 0) - (a.frameCount ?? 0));
    }
    return list;
  });

  ngOnInit(): void {
    this.loadPage(0);

    this.liveTelemetry.subscribeToSessions((json: string) => {
      const sessions: CanSession[] = JSON.parse(json);
      this.sessions.update((prev) => {
        const map = new Map(prev.map((s) => [s.sessionId, s]));
        sessions.forEach((s) => map.set(s.sessionId, { ...map.get(s.sessionId), ...s } as CanSession));
        return Array.from(map.values());
      });
    });
  }

  private loadPage(page: number): void {
    const isFirst = page === 0;
    if (isFirst) this.loading.set(true);
    else this.loadingMore.set(true);

    this.canService.getSessionsPaged(page, this.pageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const items: CanSession[] = res.content ?? res;
          if (isFirst) {
            this.sessions.set(items);
          } else {
            this.sessions.update((prev) => [...prev, ...items]);
          }
          this.hasMore.set(res.hasMore ?? false);
          this.currentPage.set(page);
          if (isFirst) this.loading.set(false);
          else this.loadingMore.set(false);
        },
        error: () => {
          if (isFirst) this.loading.set(false);
          else this.loadingMore.set(false);
        },
      });
  }

  loadMore(): void {
    this.loadPage(this.currentPage() + 1);
  }

  togglePanel(panel: 'simulator' | 'upload'): void {
    if (panel === 'simulator') {
      this.showSimulator.update((v) => !v);
      this.showUpload.set(false);
    } else {
      this.showUpload.update((v) => !v);
      this.showSimulator.set(false);
    }
  }

  inspect(sessionId: string): void {
    this.router.navigate(['/admin/workspace/session', sessionId], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  onSimulatorStarted(): void {
    this.simulatorRunning.set(true);
    this.liveTelemetry.connectGlobal();
    this.loadPage(0);
    setTimeout(() => this.loadPage(0), 2500);

    this.stopPolling$.next();
    interval(5000)
      .pipe(takeUntil(this.stopPolling$), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.silentRefresh());
  }

  onSimulatorStopped(): void {
    this.stopPolling$.next();
    this.simulatorRunning.set(false);
    this.showSimulator.set(false);
    this.loadPage(0);
  }

  ngOnDestroy(): void {
    this.stopPolling$.next();
    this.stopPolling$.complete();
  }

  private silentRefresh(): void {
    this.canService.getSessionsPaged(0, this.pageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const items: CanSession[] = res.content ?? res;
          this.sessions.update((prev) => {
            const map = new Map(prev.map((s) => [s.sessionId, s]));
            items.forEach((s) => map.set(s.sessionId, { ...map.get(s.sessionId), ...s } as CanSession));
            return Array.from(map.values());
          });
        },
      });
  }

  onUploadComplete(sessionId: string): void {
    this.showUpload.set(false);
    this.loadPage(0);
    setTimeout(() => this.inspect(sessionId), 400);
  }

  displayName(s: CanSession): string {
    return s.sourceFilename ?? `${s.sessionId.slice(0, 8)}…`;
  }

  dotClass(s: CanSession): string {
    if (s.status === 'LIVE') return 'live';
    if (s.status === 'COMPLETE') return 'complete';
    if (s.status === 'ERROR') return 'error';
    return 'other';
  }

  duration(s: CanSession): string | null {
    if (!s.startTs || !s.endTs) return null;
    const sec = Math.round(s.endTs - s.startTs);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${m}m ${r}s`;
  }
}
