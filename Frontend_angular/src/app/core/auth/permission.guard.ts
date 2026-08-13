import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';

const ADMIN_ROLE_NAMES = new Set(['ADMIN', 'ROLE_ADMIN']);

export const permissionGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  const user = authStore.user();
  const isAdmin = user?.roles?.some(
    r => ADMIN_ROLE_NAMES.has((r.name ?? '').trim().toUpperCase())
  ) ?? false;

  if (isAdmin) return true;

  const permission = route.data['permission'] as string | undefined;
  if (permission && authStore.hasPermission(permission)) return true;

  return router.createUrlTree(['/admin']);
};
