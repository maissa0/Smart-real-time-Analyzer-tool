import { Route } from '@angular/router';
import { adminGuard } from '../../core/auth/admin.guard';
import { authGuard } from '../../core/auth/auth.guard';

export const settingsRoutes: Route[] = [
  { path: '', redirectTo: 'audit', pathMatch: 'full' },
  {
    path: 'audit',
    canActivate: [adminGuard],
    loadComponent: () => import('./audit-log/audit-log.component').then((m) => m.AuditLogComponent),
  },
  {
    path: 'security',
    canActivate: [authGuard],
    loadComponent: () => import('./security-center/security-center.component').then((m) => m.SecurityCenterComponent),
  },
  { path: '**', redirectTo: 'audit' },
];
