import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import type { AuthResponse, MfaAuthResponse } from '../../data/models';

export type LoginResult = { type: 'success'; data: AuthResponse } | { type: 'mfa_required'; data: MfaAuthResponse };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/auth`;

  private readonly loginUrl = `${this.base}/login`;
  private readonly mfaVerifyUrl = `${this.base}/mfa/verify`;
  private readonly registerUrl = `${this.base}/register`;
  private readonly refreshUrl = `${this.base}/refresh`;
  private readonly forgotPasswordUrl = `${this.base}/forgot-password`;
  private readonly verifyOtpUrl = `${this.base}/verify-otp`;
  private readonly resetPasswordUrl = `${this.base}/reset-password`;

  /**
   * Login with email and password.
   * Returns success if 200, or mfa_required if 202.
   */
  login(email: string, password: string): Observable<LoginResult> {
    return this.http
      .post<AuthResponse | MfaAuthResponse>(this.loginUrl, { email, password }, { observe: 'response' })
      .pipe(
        map((res) => {
          if (res.status === 202) {
            return { type: 'mfa_required' as const, data: res.body as MfaAuthResponse };
          }
          return { type: 'success' as const, data: res.body as AuthResponse };
        })
      );
  }

  /**
   * Complete MFA verification.
   */
  mfaVerify(mfaToken: string, code: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(this.mfaVerifyUrl, { mfaToken, code });
  }

  register(name: string, email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(this.registerUrl, { name, email, password });
  }

  refresh(refreshToken: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(this.refreshUrl, { refreshToken });
  }

  forgotPassword(email: string): Observable<void> {
    return this.http.post<void>(this.forgotPasswordUrl, { email });
  }

  verifyOtp(email: string, code: string): Observable<{ resetToken: string; expiresInSeconds: number }> {
    return this.http.post<{ resetToken: string; expiresInSeconds: number }>(this.verifyOtpUrl, { email, code });
  }

  resetPassword(resetToken: string, newPassword: string): Observable<void> {
    return this.http.post<void>(this.resetPasswordUrl, { resetToken, newPassword });
  }
}
