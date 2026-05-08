import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../../store/auth.store';

/**
 * Guard that redirects to /auth/login if user is not authenticated.
 * Also checks is_active: if user is disabled (is_active = false), denies access
 * and redirects with "Account Disabled" - regardless of valid token.
 * Use for /admin and other protected routes.
 */
export const authGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    return router.createUrlTree(['/auth/login']);
  }

  // Check isActive: disabled accounts must be denied access
  const user = authStore.user();
  if (user && !user.isActive) {
    authStore.logout();
    return router.createUrlTree(['/auth/login'], {
      queryParams: { reason: 'disabled' },
    });
  }

  return true;
};
