import { Route } from '@angular/router';

export const settingsRoutes: Route[] = [
  { path: '', redirectTo: 'audit', pathMatch: 'full' },
  { path: 'audit', loadComponent: () => import('./audit-log/audit-log.component').then((m) => m.AuditLogComponent) },
  { path: 'security', loadComponent: () => import('./security-center/security-center.component').then((m) => m.SecurityCenterComponent) },
  { path: '**', redirectTo: 'audit' },
];
