import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';

/**
 * Guard that only allows users with Admin role.
 * Regular users are redirected to /admin (dashboard).
 */
export const adminGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router    = inject(Router);

  const user = authStore.user();
  const ADMIN_ROLE_NAMES = new Set(['ADMIN', 'ROLE_ADMIN']);
  const isAdmin = user?.roles?.some(
    r => ADMIN_ROLE_NAMES.has((r.name ?? '').trim().toUpperCase())
  ) ?? false;

  if (isAdmin) return true;
  return router.createUrlTree(['/admin']);
};
