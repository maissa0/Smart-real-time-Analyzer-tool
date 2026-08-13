import { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard';

export const ANALYSER_ROUTES: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./workspace-sessions/workspace-sessions.component').then(
        (m) => m.WorkspaceSessionsComponent
      ),
  },
  {
    path: 'session/:sessionId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./session-inspector/session-inspector.component').then(
        (m) => m.SessionInspectorComponent
      ),
  },
  {
    path: 'session/:sessionId/replay',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./session-replay/session-replay.component').then(
        (m) => m.SessionReplayComponent
      ),
  },
];
