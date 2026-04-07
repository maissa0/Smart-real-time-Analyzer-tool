import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

/**
 * Attaches `Authorization: Bearer <token>` when a JWT is present.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  // Never attach Authorization for auth endpoints and preflight checks.
  // Those endpoints are explicitly `permitAll()` on the backend and the JWT filter skips them,
  // but injecting a stale/irrelevant token can still break CORS/preflight behavior.
  const isOptionsRequest = req.method?.toUpperCase() === 'OPTIONS';
  let pathname = '';
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    // Fallback for non-absolute URLs (shouldn't happen here).
    pathname = req.url;
  }

  const isAuthSkipPath =
    pathname.endsWith('/api/users/login') ||
    pathname.endsWith('/api/users/register') ||
    pathname.endsWith('/api/analyze');

  if (token && !isOptionsRequest && !isAuthSkipPath) {
    return next(
      req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      }),
    );
  }
  return next(req);
};
