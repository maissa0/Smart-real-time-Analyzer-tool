import { Route } from '@angular/router';
import { adminGuard } from '../../core/auth/admin.guard';

export const usersRoutes: Route[] = [
  { path: '', redirectTo: 'list', pathMatch: 'full' },
  {
    path: 'list',
    loadComponent: () => import('./user-list/user-list.component').then((m) => m.UserListComponent),
    canActivate: [adminGuard],
  },
  { path: '**', redirectTo: 'list' },
];
