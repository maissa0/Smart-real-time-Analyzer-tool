import { Routes } from '@angular/router';

export const CATALOGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./catalog-page.component').then((m) => m.CatalogPageComponent),
  },
  {
    path: ':filename',
    loadComponent: () =>
      import('./catalog-detail-page.component').then(
        (m) => m.CatalogDetailPageComponent),
  },
];
