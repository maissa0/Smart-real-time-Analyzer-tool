import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../../store/auth.store';

export const permissionGuard = (permission: string): CanActivateFn => {
  return () => {
    const authStore = inject(AuthStore);
    const router = inject(Router);
    if (authStore.hasPermission(permission)) {
      return true;
    }
    return router.createUrlTree(['/admin']);
  };
};
