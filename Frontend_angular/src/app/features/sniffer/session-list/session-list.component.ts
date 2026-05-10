import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { interval } from 'rxjs';
import { CanSession } from '../../../data/models/can.model';
import { API_BASE_URL } from '../../../core/config/api.config';

/**
 * Standalone session list panel extracted from SnifferComponent.
 *
 * Owns: session loading, polling, filtering, selection.
 * Does NOT own: frame loading, chart rendering, integrity analysis.
 *
 * Inputs:
 *   liveOnly  — show only live_simulation sessions
 *   carId     — if set, load sessions from GET /api/cars/{carId}/sessions
 *
 * Outputs:
 *   sessionSelected — emits the selected CanSession object
 */
@Component({
  selector: 'app-session-list',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .sl-wrap { display: flex; flex-direction: column; gap: 0.5rem; }

    .sl-title {
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.18em;
      color: #b0ff44; display: flex; align-items: center; gap: 0.5rem;
      margin-bottom: 0.25rem;
    }
    .sl-count {
      background: rgba(176,255,68,0.15); color: #b0ff44;
      border-radius: 8px; padding: 1px 6px; font-size: 0.6rem;
    }

    .sl-skeleton { height: 52px; background: #161b22; border-radius: 8px;
      animation: sl-pulse 1.4s ease-in-out infinite; }
    @keyframes sl-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

    .sl-empty { font-size: 0.78rem; color: #484f58; padding: 1rem 0; text-align: center; }

    .sl-list { display: flex; flex-direction: column; gap: 0.35rem; max-height: 480px; overflow-y: auto; }

    .sl-item {
      background: #161b22; border: 1px solid #21262d; border-radius: 8px;
      padding: 0.6rem 0.75rem; cursor: pointer; transition: border-color 0.2s;
    }
    .sl-item:hover { border-color: rgba(176,255,68,0.3); }
    .sl-item.active {
      border-color: #b0ff44; background: rgba(176,255,68,0.05);
    }
    .sl-item-header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 0.5rem;
    }
    .sl-name {
      font-size: 0.75rem; font-weight: 600; color: #e6edf3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 160px;
    }
    .sl-live-dot {
      width: 7px; height: 7px; border-radius: 50%; background: #b0ff44;
      flex-shrink: 0; animation: sl-blink 1.2s ease-in-out infinite;
    }
    @keyframes sl-blink { 0%,100%{opacity:1} 50%{opacity:0.25} }
    .sl-frames { font-size: 0.68rem; color: #8a9ab0; }
    .sl-date { font-size: 0.65rem; color: #484f58; margin-top: 0.2rem; }

    .sl-load-more {
      margin-top: 0.25rem; width: 100%; padding: 6px;
      background: transparent; border: 1px solid #21262d; border-radius: 6px;
      color: #8a9ab0; font-size: 0.72rem; cursor: pointer; transition: all 0.2s;
    }
    .sl-load-more:hover { border-color: rgba(176,255,68,0.3); color: #b0ff44; }
  `],
  template: `
    <div class="sl-wrap">
      <div class="sl-title">
        LOG SESSIONS
        <span class="sl-count">{{ filteredSessions().length }}</span>
      </div>

      <!-- Loading skeletons -->
      @if (loading()) {
        <div class="sl-skeleton"></div>
        <div class="sl-skeleton"></div>
        <div class="sl-skeleton"></div>
      }

      <!-- Empty state -->
      @if (!loading() && filteredSessions().length === 0) {
        <div class="sl-empty">No sessions found</div>
      }

      <!-- Session list -->
      <div class="sl-list">
        @for (s of filteredSessions(); track s.id) {
          <div class="sl-item"
            [class.active]="selectedId() === s.sessionId"
            (click)="select(s)">
            <div class="sl-item-header">
              <span class="sl-name">{{ s.sourceFilename ?? s.sessionId }}</span>
              @if (s.sourceFilename === 'live_simulation') {
                <span class="sl-live-dot" title="Live"></span>
              }
            </div>
            <div class="sl-frames">
              {{ (s.frameCount ?? 0).toLocaleString() }} frames
            </div>
            <div class="sl-date">
              {{ formatDate(s.createdAt) }}
            </div>
          </div>
        }
      </div>

      <!-- Load more -->
      @if (hasMore() && !loading()) {
        <button class="sl-load-more" (click)="loadMore()">
          Load more…
        </button>
      }
    </div>
  `,
})
export class SessionListComponent implements OnInit {

  // ── Inputs ────────────────────────────────────────────────────────────────
  readonly liveOnly = input<boolean>(false);
  readonly carId    = input<string | null>(null);

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly sessionSelected = output<CanSession>();

  // ── Private deps ──────────────────────────────────────────────────────────
  private readonly http       = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  // ── State ─────────────────────────────────────────────────────────────────
  readonly sessions   = signal<CanSession[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly loading    = signal(false);
  readonly hasMore    = signal(false);

  private page     = 0;
  private pageSize = 20;

  readonly filteredSessions = computed(() => {
    const all = this.sessions();
    if (this.liveOnly()) {
      return all.filter(s => s.sourceFilename === 'live_simulation');
    }
    return all;
  });

  ngOnInit(): void {
    this.loadSessions(true);

    // Poll every 5 seconds to pick up new live sessions
    interval(5_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadSessions(false));
  }

  select(session: CanSession): void {
    this.selectedId.set(session.sessionId);
    this.sessionSelected.emit(session);
  }

  loadMore(): void {
    this.page++;
    this.loadSessions(false, true);
  }

  formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('fr-FR', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private loadSessions(showLoading = true, append = false): void {
    if (showLoading) this.loading.set(true);

    const carId = this.carId();
    const url = carId
      ? `${API_BASE_URL}/api/cars/${carId}/sessions`
      : `${API_BASE_URL}/api/can/sessions?page=${this.page}&size=${this.pageSize}`;

    const token = localStorage.getItem('access_token');
    const headers = token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();

    this.http
      .get<any>(url, { headers })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // Handle both array response and paginated {content, hasMore} response
          let items: CanSession[];
          if (Array.isArray(res)) {
            items = res;
            this.hasMore.set(false);
          } else {
            items = res.content ?? [];
            this.hasMore.set(res.hasMore ?? false);
          }

          // Sort: live first, then by createdAt DESC
          items.sort((a, b) => {
            const aLive = a.sourceFilename === 'live_simulation' ? 1 : 0;
            const bLive = b.sourceFilename === 'live_simulation' ? 1 : 0;
            if (aLive !== bLive) return bLive - aLive;
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
          });

          if (append) {
            this.sessions.update(existing => [...existing, ...items]);
          } else {
            this.sessions.set(items);
          }
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[SessionListComponent] load error:', err);
          this.loading.set(false);
        },
      });
  }
}
