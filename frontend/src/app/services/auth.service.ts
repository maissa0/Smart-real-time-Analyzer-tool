import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';

const JWT_KEY      = 'jwt';
const USER_INFO_KEY = 'user_info';

export interface LoginResponse {
  accessToken:  string;
  tokenType:    string;
  userId:       number;
  username:     string;
  email:        string;
  role:         string;
  mfaRequired?: boolean;
  mfaToken?:    string;
}

export interface RegisterResponse {
  id:        number;
  username:  string;
  email:     string;
  role:      string;
  createdAt: string;
}

export interface StoredUserInfo {
  userId:   number;
  username: string;
  email:    string;
  role:     string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${API_BASE_URL}/api/users/login`, { username, password })
      .pipe(tap((res) => {
        if (!res.mfaRequired) {
          localStorage.setItem(JWT_KEY, res.accessToken);
          localStorage.setItem(USER_INFO_KEY, JSON.stringify({
            userId:   res.userId,
            username: res.username,
            email:    res.email,
            role:     res.role,
          } satisfies StoredUserInfo));
        }
      }));
  }

  mfaVerify(mfaToken: string, code: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${API_BASE_URL}/api/users/login/mfa`, { mfaToken, code })
      .pipe(tap((res) => {
        localStorage.setItem(JWT_KEY, res.accessToken);
        localStorage.setItem(USER_INFO_KEY, JSON.stringify({
          userId:   res.userId,
          username: res.username,
          email:    res.email,
          role:     res.role,
        } satisfies StoredUserInfo));
      }));
  }

  register(username: string, email: string, password: string): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${API_BASE_URL}/api/users/register`, {
      username, email, password,
    });
  }

  forgotPassword(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${API_BASE_URL}/api/users/forgot-password`, { email });
  }

  resetPassword(email: string, otp: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${API_BASE_URL}/api/users/reset-password`, {
      email, otp, newPassword,
    });
  }

  logout(): void {
    // Fire-and-forget logout audit on the backend, then clear local state
    const token = this.getToken();
    if (token) {
      this.http.post(`${API_BASE_URL}/api/users/logout`, {}).subscribe({ error: () => {} });
    }
    localStorage.removeItem(JWT_KEY);
    localStorage.removeItem(USER_INFO_KEY);
  }

  getToken(): string | null {
    return localStorage.getItem(JWT_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  private getStoredInfo(): StoredUserInfo | null {
    try {
      const raw = localStorage.getItem(USER_INFO_KEY);
      return raw ? (JSON.parse(raw) as StoredUserInfo) : null;
    } catch { return null; }
  }

  getCurrentUser(): string | null {
    return this.getStoredInfo()?.username ?? this.decodeSubFromJwt();
  }

  getUserId(): number | null {
    return this.getStoredInfo()?.userId ?? null;
  }

  getUserEmail(): string | null {
    return this.getStoredInfo()?.email ?? null;
  }

  getUserRole(): string | null {
    return this.getStoredInfo()?.role ?? null;
  }

  isAdmin(): boolean {
    return this.getUserRole() === 'ADMIN';
  }

  /** Refresh stored info after a profile update. */
  refreshStoredInfo(info: Partial<StoredUserInfo>): void {
    const current = this.getStoredInfo();
    if (current) {
      localStorage.setItem(USER_INFO_KEY, JSON.stringify({ ...current, ...info }));
    }
  }

  private decodeSubFromJwt(): string | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        Array.prototype.map
          .call(atob(base64), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );
      const data = JSON.parse(json) as { sub?: string };
      return data.sub ?? null;
    } catch { return null; }
  }
}
