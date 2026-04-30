import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Attaches `Authorization: Bearer <token>` when a JWT is present.
 * Also intercepts 401 responses: clears stale credentials and redirects to /login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth   = inject(AuthService);
  const router = inject(Router);
  const token  = auth.getToken();

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

  const outgoing = (token && !isOptionsRequest && !isAuthSkipPath)
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(outgoing).pipe(
    catchError(err => {
      if (err?.status === 401 && !isAuthSkipPath) {
        console.warn('[Auth] 401 received — token expired or invalid. Redirecting to login.');
        localStorage.removeItem('jwt');
        localStorage.removeItem('user_info');
        router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
