import { Routes } from '@angular/router';

export const REQUIREMENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./requirements-page.component').then((m) => m.RequirementsPageComponent),
  },
  {
    // Must precede ':filename' so "new" is not treated as a file.
    path: 'new',
    loadComponent: () =>
      import('./requirement-new-page.component').then(
        (m) => m.RequirementNewPageComponent
      ),
  },
  {
    path: ':filename',
    loadComponent: () =>
      import('./requirement-detail-page.component').then(
        (m) => m.RequirementDetailPageComponent
      ),
  },
];
