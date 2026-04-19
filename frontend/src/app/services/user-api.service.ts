import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';

export interface UserRecord {
  id:        number;
  username:  string;
  email:     string;
  role:      'ADMIN' | 'USER';
  createdAt: string;
  avatarUrl: string | null;
}

export interface CreateUserPayload {
  username: string;
  email:    string;
  password: string;
  role:     'ADMIN' | 'USER';
}

export interface UpdateUserPayload {
  username: string;
  email:    string;
  role:     'ADMIN' | 'USER';
}

export interface UpdateMePayload {
  username:        string;
  email:           string;
  currentPassword?: string | null;
  newPassword:     string | null;
}

@Injectable({ providedIn: 'root' })
export class UserApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/users`;

  getAll(): Observable<UserRecord[]> {
    return this.http.get<UserRecord[]>(this.base);
  }

  create(payload: CreateUserPayload): Observable<UserRecord> {
    return this.http.post<UserRecord>(this.base, payload);
  }

  update(id: number, payload: UpdateUserPayload): Observable<UserRecord> {
    return this.http.put<UserRecord>(`${this.base}/${id}`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  getMe(): Observable<UserRecord> {
    return this.http.get<UserRecord>(`${this.base}/me`);
  }

  updateMe(payload: UpdateMePayload): Observable<UserRecord> {
    return this.http.put<UserRecord>(`${this.base}/me`, payload);
  }

  uploadAvatar(file: File): Observable<UserRecord> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<UserRecord>(`${this.base}/me/avatar`, fd);
  }

  avatarUrl(user: UserRecord): string | null {
    if (!user.avatarUrl) return null;
    return `${API_BASE_URL}${user.avatarUrl}`;
  }
}
