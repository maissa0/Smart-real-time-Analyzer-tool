import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { adminGuard } from './core/auth/admin.guard';
import { permissionGuard } from './core/auth/permission.guard';

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
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent
          ),
      },
      {
        path: 'sniffer',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/sniffer/sniffer.routes').then(
            (m) => m.SNIFFER_ROUTES
          ),
      },
      {
        path: 'workspace',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/analyser/analyser.routes').then(
            (m) => m.ANALYSER_ROUTES
          ),
      },
      {
        path: 'catalogs',
        canActivate: [permissionGuard],
        data: { permission: 'catalog:read' },
        loadChildren: () =>
          import('./features/catalogs/catalogs.routes').then(
            (m) => m.CATALOGS_ROUTES
          ),
      },
      {
        path: 'requirements',
        canActivate: [permissionGuard],
        data: { permission: 'requirement:read' },
        loadChildren: () =>
          import('./features/requirements/requirements.routes').then(
            (m) => m.REQUIREMENTS_ROUTES
          ),
      },
      {
        path: 'fleet',
        canActivate: [permissionGuard],
        data: { permission: 'car:read' },
        loadChildren: () =>
          import('./features/fleet/fleet.routes').then(
            (m) => m.FLEET_ROUTES
          ),
      },
      {
        path: 'users',
        canActivate: [adminGuard],
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
        path: 'compare',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/compare/session-compare-page.component').then(
            (m) => m.SessionComparePageComponent
          ),
      },
      {
        path: 'profile',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/profile/profile.routes').then(
            (m) => m.profileRoutes
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'auth/login' },
];
