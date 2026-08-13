import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, EMPTY, throwError } from 'rxjs';
import { AuthStore } from '../store/auth.store';

const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/verify-otp',
  '/api/auth/reset-password',
  '/api/auth/set-password',
  '/api/auth/mfa/verify',
  '/uploads/avatars/',
];

const WEBSOCKET_PATH = '/ws-ecu-gateway';

function extractPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

function isBackendTokenRejection(err: HttpErrorResponse): boolean {
  if (err.status !== 401) return false;
  const body = err.error as { message?: string } | null | string;
  if (!body) return true;
  if (typeof body === 'string') {
    const lower = body.toLowerCase();
    return lower.includes('unauthorized') || lower.includes('please login');
  }
  const msg = body.message?.toLowerCase() ?? '';
  return msg.includes('unauthorized') || msg.includes('please login');
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  const pathname = extractPathname(req.url);
  
  // Logic: Only skip token attachment if path is EXPLICITLY in PUBLIC_PATHS.
  // Everything else (including all /api/ sub-paths) is treated as secure.
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isWebSocket = req.url.includes(WEBSOCKET_PATH);
  const isRefreshCall = pathname.startsWith('/api/auth/refresh');

  let authReq = req;

  if (!isPublic) {
    const token = localStorage.getItem('access_token');

    // Diagnostic logging
    if (typeof ngDevMode !== 'undefined' && ngDevMode) {
      console.log(`[AUTH INTERCEPTOR] ${req.method} ${pathname} | Auth: ${authStore.isAuthenticated() ? '✅' : '❌'}`);
    }

    // Gate: If in-memory state is unauthenticated, abort to prevent logout loops.
    // Emits a synthetic 401 rather than EMPTY — EMPTY completes with no value and no error,
    // so firstValueFrom()/lastValueFrom() callers would reject with an unhandled EmptyError,
    // and plain .subscribe({error}) callbacks would never fire at all.
    if (!authStore.isAuthenticated()) {
      return throwError(() => new HttpErrorResponse({
        status: 401,
        statusText: 'Unauthorized',
        url: req.url,
        error: { message: 'Not authenticated' },
      }));
    }

    // Force attach token if present
    if (token) {
      authReq = req.clone({ 
        setHeaders: { Authorization: `Bearer ${token}` } 
      });
    }
  }

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      const refreshFailed = isRefreshCall && err.status >= 400;
      const accessTokenRejected = !isPublic && !isWebSocket && isBackendTokenRejection(err);

      if (refreshFailed) {
        if (authStore.isAuthenticated()) {
          authStore.logout();
          router.navigate(['/auth/login'], { queryParams: { reason: 'session_expired' }, replaceUrl: true });
        }
        return EMPTY;
      }

      if (accessTokenRejected) {
        if (authStore.isAuthenticated()) {
          authStore.softLogout();
          router.navigate(['/auth/login'], { queryParams: { reason: 'session_expired' }, replaceUrl: true });
        }
        return EMPTY;
      }

      return throwError(() => err);
    })
  );
};