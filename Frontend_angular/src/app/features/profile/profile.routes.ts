import { Route } from '@angular/router';

export const profileRoutes: Route[] = [
  { path: '', loadComponent: () => import('./profile-settings/profile-settings.component').then((m) => m.ProfileSettingsComponent) },
  { path: '**', redirectTo: '' },
];
