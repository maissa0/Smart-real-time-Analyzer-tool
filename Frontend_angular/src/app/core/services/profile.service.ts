import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import type { User, Session } from '../models';

export interface UserProfileUpdateRequest {
  fullName?: string;
  jobTitle?: string;
  department?: string;
  phone?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/v1/profile/me`;

  getMe(): Observable<User> {
    return this.http.get<User>(this.base);
  }

  updateMe(body: UserProfileUpdateRequest): Observable<User> {
    return this.http.put<User>(this.base, body);
  }

  uploadAvatar(file: File): Observable<{ avatarUrl: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ avatarUrl: string }>(
      `${this.base}/avatar`, formData
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.patch<void>(`${this.base}/password`, { currentPassword, newPassword });
  }

  getSessions(): Observable<Session[]> {
    return this.http.get<Session[]>(`${this.base}/sessions`);
  }

  revokeSession(sessionId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/api/v1/sessions/${sessionId}`);
  }

  mfaEnable(): Observable<{ secret: string; qrCodeUrl: string }> {
    return this.http.post<{ secret: string; qrCodeUrl: string }>(`${this.base}/mfa/enable`, {});
  }

  mfaConfirm(code: string): Observable<{ backupCodes: string[] }> {
    return this.http.post<{ backupCodes: string[] }>(`${this.base}/mfa/confirm`, { code });
  }

  mfaDisable(password: string): Observable<void> {
    return this.http.post<void>(`${this.base}/mfa/disable`, { password });
  }
}
