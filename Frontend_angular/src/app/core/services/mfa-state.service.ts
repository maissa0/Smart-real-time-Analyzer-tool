import { Injectable } from '@angular/core';

const MFA_TOKEN_KEY = 'mfa_pending_token';
const MFA_RETURN_URL_KEY = 'mfa_return_url';

/**
 * Holds transient state during the MFA verification step:
 *  - mfaToken   — the short-lived JWT returned with a 202 login response.
 *  - returnUrl  — the route the user was trying to reach before being sent
 *                 to login, so we can restore it after MFA completes.
 *
 * Uses sessionStorage so both values survive a page refresh but are
 * automatically discarded when the browser tab is closed.
 * Every storage call is wrapped in try/catch to guard against
 * restricted environments (e.g. private-mode quota errors).
 */
@Injectable({ providedIn: 'root' })
export class MfaStateService {
  setToken(token: string): void {
    try {
      sessionStorage.setItem(MFA_TOKEN_KEY, token);
    } catch {
      // sessionStorage unavailable — token will not survive a refresh
    }
  }

  getToken(): string | null {
    try {
      return sessionStorage.getItem(MFA_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  setReturnUrl(url: string): void {
    try {
      sessionStorage.setItem(MFA_RETURN_URL_KEY, url);
    } catch {
      // ignore
    }
  }

  getReturnUrl(): string | null {
    try {
      return sessionStorage.getItem(MFA_RETURN_URL_KEY);
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      sessionStorage.removeItem(MFA_TOKEN_KEY);
      sessionStorage.removeItem(MFA_RETURN_URL_KEY);
    } catch {
      // ignore — nothing to clear
    }
  }
}
