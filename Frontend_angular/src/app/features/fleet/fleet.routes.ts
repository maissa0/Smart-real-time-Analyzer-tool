import { Routes } from '@angular/router';

export const FLEET_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./fleet-page.component').then((m) => m.FleetPageComponent),
  },
  {
    path: ':carUid/sessions',
    loadComponent: () =>
      import('./car-sessions-page.component').then(
        (m) => m.CarSessionsPageComponent
      ),
  },
];
