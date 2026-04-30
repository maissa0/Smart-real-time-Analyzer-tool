import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';

export interface AuditLogRecord {
  id:           number;
  userId:       number | null;
  username:     string | null;
  action:       string;
  resourceType: string | null;
  resourceId:   string | null;
  ipAddress:    string | null;
  userAgent:    string | null;
  timestamp:    string;
  details:      string | null;
}

export interface AuditPage {
  content:       AuditLogRecord[];
  page:          number;
  size:          number;
  totalElements: number;
  totalPages:    number;
  first:         boolean;
  last:          boolean;
}

export interface SessionRecord {
  id:           number;
  ipAddress:    string;
  userAgent:    string;
  createdAt:    string;
  lastActiveAt: string;
  expiresAt:    string;
  isCurrent:    boolean;
}

export interface UploadRecord {
  id:               number;
  originalFilename: string;
  uploadedAt:       string;
  frameCount:       number | null;
}

export interface UserRecord {
  id:         number;
  username:   string;
  email:      string;
  role:       'ADMIN' | 'USER';
  createdAt:  string;
  avatarUrl:  string | null;
  mfaEnabled: boolean;
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
    // S3/MinIO URLs are already absolute; local avatar URLs are relative API paths
    if (user.avatarUrl.startsWith('http')) return user.avatarUrl;
    return `${API_BASE_URL}${user.avatarUrl}`;
  }

  mfaSetup(): Observable<{ secret: string; qrCodeUrl: string }> {
    return this.http.get<{ secret: string; qrCodeUrl: string }>(`${this.base}/mfa/setup`);
  }

  mfaEnable(code: string): Observable<{ mfaEnabled: boolean }> {
    return this.http.post<{ mfaEnabled: boolean }>(`${this.base}/mfa/enable`, { code });
  }

  mfaDisable(password: string, code: string): Observable<{ mfaEnabled: boolean }> {
    return this.http.post<{ mfaEnabled: boolean }>(`${this.base}/mfa/disable`, { password, code });
  }

  // ── Audit logs ─────────────────────────────────────────────────────────────

  getMyAuditLogs(page = 0, size = 20): Observable<AuditPage> {
    return this.http.get<AuditPage>(`${API_BASE_URL}/api/audit?page=${page}&size=${size}`);
  }

  getAllAuditLogs(page = 0, size = 20): Observable<AuditPage> {
    return this.http.get<AuditPage>(`${API_BASE_URL}/api/audit/all?page=${page}&size=${size}`);
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  getSessions(): Observable<SessionRecord[]> {
    return this.http.get<SessionRecord[]>(`${API_BASE_URL}/api/sessions`);
  }

  revokeSession(id: number): Observable<unknown> {
    return this.http.delete(`${API_BASE_URL}/api/sessions/${id}`);
  }

  revokeAllOtherSessions(): Observable<unknown> {
    return this.http.delete(`${API_BASE_URL}/api/sessions/others`);
  }

  // ── Uploads ────────────────────────────────────────────────────────────────

  getMyUploads(): Observable<UploadRecord[]> {
    return this.http.get<UploadRecord[]>(`${API_BASE_URL}/api/uploads`);
  }

  reanalyzeUpload(id: number): Observable<any> {
    return this.http.get<any>(`${API_BASE_URL}/api/uploads/${id}/reanalyze`);
  }
}
