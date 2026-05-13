import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../../store/auth.store';

/**
 * Guard that only allows users with Admin role.
 * Regular users are redirected to /admin (dashboard).
 */
export const adminGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router    = inject(Router);

  const user = authStore.user();
  const isAdmin = user?.roles?.some(
    r => r.name === 'Admin' || r.name === 'ROLE_ADMIN'
  ) ?? false;

  if (isAdmin) return true;
  return router.createUrlTree(['/admin']);
};
