import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';

const JWT_STORAGE_KEY = 'jwt';

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
}

export interface RegisterResponse {
  id: number;
  username: string;
  email: string;
  role: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${API_BASE_URL}/api/users/login`, { username, password })
      .pipe(tap((res) => localStorage.setItem(JWT_STORAGE_KEY, res.accessToken)));
  }

  register(username: string, email: string, password: string): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${API_BASE_URL}/api/users/register`, {
      username,
      email,
      password,
    });
  }

  logout(): void {
    localStorage.removeItem(JWT_STORAGE_KEY);
  }

  getToken(): string | null {
    return localStorage.getItem(JWT_STORAGE_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  /** Decodes JWT payload and returns the `sub` claim (username). */
  getCurrentUser(): string | null {
    const token = this.getToken();
    if (!token) {
      return null;
    }
    try {
      const payload = token.split('.')[1];
      if (!payload) {
        return null;
      }
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        Array.prototype.map
          .call(atob(base64), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );
      const data = JSON.parse(json) as { sub?: string };
      return data.sub ?? null;
    } catch {
      return null;
    }
  }
}
