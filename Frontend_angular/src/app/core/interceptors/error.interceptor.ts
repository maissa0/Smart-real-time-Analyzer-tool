import {
  HttpInterceptorFn,
  HttpErrorResponse,
  HttpStatusCode,
  HttpContextToken,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';
import type { ApiError } from '../types/api.types';

export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const body = err.error as ApiError | { message?: string; error?: string } | null;

      if (err.status === HttpStatusCode.UnprocessableEntity) {
        const message = body?.message ?? 'Validation failed. Please check your input.';
        const fieldErrors = body && 'errors' in body ? body.errors : undefined;
        const details = fieldErrors
          ? Object.entries(fieldErrors).flatMap(([field, msgs]) =>
              msgs.map((m) => `${field}: ${m}`)
            )
          : undefined;
        toast.error(message, details);
      } else if (err.status === 429) {
        const message = (body && 'error' in body ? body.error : 'Too many requests. Please try again later.') ?? 'Too many requests.';
        toast.error(message);
      } else if (err.status && err.status >= 500) {
        const message = body?.message ?? `Server error (${err.status}). Please try again later.`;
        toast.error(message);
      } else if (err.status === HttpStatusCode.Unauthorized) {
        toast.error(body?.message ?? 'Session expired. Please sign in again.');
      } else if (err.status === HttpStatusCode.Forbidden) {
        toast.error(body?.message ?? 'You do not have permission to perform this action.');
      } else if (err.status === HttpStatusCode.NotFound) {
        if (!req.context.get(SKIP_ERROR_TOAST)) {
          toast.warning(body?.message ?? 'The requested resource was not found.');
        }
      } else if (err.status && err.status >= 400) {
        toast.error(body?.message ?? `Request failed (${err.status}).`);
      } else if (err.error instanceof ErrorEvent) {
        toast.error('A network error occurred. Please check your connection.');
      } else {
        toast.error('An unexpected error occurred.');
      }

      return throwError(() => err);
    })
  );
};
