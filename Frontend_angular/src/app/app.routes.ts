import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const appRoutes: Routes = [
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' },
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layouts/admin-layout/admin-layout.component').then(
        (m) => m.AdminLayoutComponent
      ),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent
          ),
      },
      {
        path: 'sniffer',
        loadChildren: () =>
          import('./features/sniffer/sniffer.routes').then(
            (m) => m.SNIFFER_ROUTES
          ),
      },
      {
        path: 'workspace',
        loadComponent: () =>
          import('./features/analyser/can-workspace.component').then(
            (m) => m.CanWorkspaceComponent
          ),
      },
      {
        path: 'fleet',
        loadComponent: () =>
          import('./features/fleet/fleet-page.component').then(
            (m) => m.FleetPageComponent
          ),
      },
      {
        path: 'users',
        loadChildren: () =>
          import('./features/users/users.routes').then((m) => m.usersRoutes),
      },
      {
        path: 'settings',
        loadChildren: () =>
          import('./features/settings/settings.routes').then(
            (m) => m.settingsRoutes
          ),
      },
      {
        path: 'profile',
        loadChildren: () =>
          import('./features/profile/profile.routes').then(
            (m) => m.profileRoutes
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'auth/login' },
];
