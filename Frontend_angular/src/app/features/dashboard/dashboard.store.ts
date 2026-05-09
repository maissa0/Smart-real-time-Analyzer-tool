import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { API_BASE_URL } from '../../core/config/api.config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DashboardStats {
  sessionCount: number;
  totalFrames: number;
  activeSessions: number;
  totalFaults: number;
  faultsByType: Record<string, number>;
  topMessageIds: Array<{ msgId: string; count: number }>;
  totalCars: number;
}

export interface RecentSession {
  id: number;
  sessionId: string;
  sourceFilename: string | null;
  startTs: number | null;
  endTs: number | null;
  frameCount: number | null;
  createdAt: string | null;
}

interface DashboardState {
  stats: DashboardStats | null;
  recentSessions: RecentSession[];
  isLoading: boolean;
  error: string | null;
}

// ── Initial state ─────────────────────────────────────────────────────────────

const initialState: DashboardState = {
  stats: null,
  recentSessions: [],
  isLoading: false,
  error: null,
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const DashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => {
    const http = inject(HttpClient);

    return {
      /**
       * Load dashboard stats and recent sessions from the backend.
       * Called on component init and every 30 seconds via polling.
       */
      loadStats(): void {
        patchState(store, { isLoading: true, error: null });

        const token = localStorage.getItem('access_token');
        const headers = token
          ? new HttpHeaders({ Authorization: `Bearer ${token}` })
          : new HttpHeaders();

        // Load stats
        http.get<DashboardStats>(
          `${API_BASE_URL}/api/dashboard/stats`,
          { headers }
        ).subscribe({
          next: (stats) => patchState(store, { stats, isLoading: false }),
          error: (err) => {
            patchState(store, {
              error: 'Failed to load dashboard stats',
              isLoading: false,
            });
            console.error('[DashboardStore] stats error:', err);
          },
        });

        // Load recent sessions
        http.get<RecentSession[]>(
          `${API_BASE_URL}/api/dashboard/recent-sessions?size=5`,
          { headers }
        ).subscribe({
          next: (recentSessions) => patchState(store, { recentSessions }),
          error: (err) => console.error('[DashboardStore] recent-sessions error:', err),
        });
      },
    };
  })
);
