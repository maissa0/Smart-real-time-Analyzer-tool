import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

/**
 * Attaches `Authorization: Bearer <token>` when a JWT is present.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  // Skip attaching Authorization only for the actual public auth endpoints.
  const isOptionsRequest = req.method?.toUpperCase() === 'OPTIONS';
  let pathname = '';
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    pathname = req.url;
  }

  const isAuthSkipPath =
    pathname.endsWith('/api/users/login') ||
    pathname.endsWith('/api/users/register');

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
