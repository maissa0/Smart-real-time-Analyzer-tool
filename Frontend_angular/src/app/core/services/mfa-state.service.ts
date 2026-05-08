import { Injectable, signal } from '@angular/core';

/**
 * Holds mfaToken temporarily during MFA verification flow.
 * Set when login returns 202, cleared after successful verify or on logout.
 */
@Injectable({ providedIn: 'root' })
export class MfaStateService {
  readonly mfaToken = signal<string | null>(null);

  setToken(token: string): void {
    this.mfaToken.set(token);
  }

  clear(): void {
    this.mfaToken.set(null);
  }

  getToken(): string | null {
    return this.mfaToken();
  }
}
