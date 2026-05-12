import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import type { User } from '../../data/models';
import type { PageResponse } from '../../data/types/api.types';
import type { UserFilterCriteria } from '../../data/types/filter.types';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/v1/users`;

  getUsers(filter: UserFilterCriteria, page: number, pageSize: number): Observable<PageResponse<User>> {
    const safePage = Math.max(1, page || 1);
    const safeSize = Math.max(1, pageSize || 10);
    let params = new HttpParams()
      .set('page', safePage.toString())
      .set('size', safeSize.toString())
      .set('sortBy', filter.sortBy || 'created_at')
      .set('sortDirection', filter.sortDirection || 'desc');

    if (filter.search?.trim()) params = params.set('search', filter.search.trim());
    if (filter.status && filter.status !== 'all') params = params.set('status', filter.status);

    return this.http.get<PageResponse<User>>(this.base, { params });
  }

  getUser(id: string): Observable<User> {
    return this.http.get<User>(`${this.base}/${id}`);
  }

  updateUser(id: string, body: { fullName?: string; jobTitle?: string; department?: string; timezone?: string; phone?: string; bio?: string }): Observable<User> {
    return this.http.put<User>(`${this.base}/${id}`, body);
  }

  patchPassword(id: string, currentPassword: string, newPassword: string): Observable<void> {
    return this.http.patch<void>(`${this.base}/${id}/password`, { currentPassword, newPassword });
  }

  inviteUser(body: { fullName: string; email: string; jobTitle?: string; department?: string; role?: string }): Observable<User> {
    return this.http.post<User>(`${this.base}/invite`, body);
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  toggleStatus(id: string, reason?: string): Observable<void> {
    return this.http.patch<void>(`${this.base}/${id}/status`, { reason: reason ?? null });
  }

  getPendingUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.base}/pending`);
  }

  approveUser(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/approve`, {});
  }

  rejectUser(id: string, reason?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/reject`, { reason: reason ?? null });
  }
}
