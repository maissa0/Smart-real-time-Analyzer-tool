import { Route } from '@angular/router';
import { permissionGuard } from '../../core/auth/permission.guard';

export const usersRoutes: Route[] = [
  { path: '', redirectTo: 'list', pathMatch: 'full' },
  {
    path: 'list',
    loadComponent: () => import('./user-list/user-list.component').then((m) => m.UserListComponent),
    canActivate: [permissionGuard('user:read')],
  },
  { path: '**', redirectTo: 'list' },
];
