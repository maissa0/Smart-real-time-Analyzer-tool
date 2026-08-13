import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { AuthStore } from '../store/auth.store';

/**
 * Returns true if the URL is safe to use as a post-login destination.
 * Rejects empty strings, external URLs (// prefix), and auth-flow paths
 * to prevent open-redirect attacks and redirect loops.
 */
function isSafeReturnUrl(url: string): boolean {
  return url.length > 0 && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/auth');
}

/**
 * Guard that redirects to /auth/login if user is not authenticated.
 * Preserves the attempted URL as a returnUrl query parameter so the
 * login page can send the user back after a successful sign-in.
 * Also enforces isActive: disabled accounts are logged out immediately.
 */
export const authGuard: CanActivateFn = (_route, state: RouterStateSnapshot) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    const queryParams = isSafeReturnUrl(state.url)
      ? { queryParams: { returnUrl: state.url } }
      : {};
    return router.createUrlTree(['/auth/login'], queryParams);
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
