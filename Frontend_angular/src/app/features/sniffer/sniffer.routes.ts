import { Routes } from '@angular/router';

export const SNIFFER_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./sniffer.component').then((m) => m.SnifferComponent),
  },
];
