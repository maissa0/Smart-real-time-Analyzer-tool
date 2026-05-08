import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import type { AuditLog } from '../../data/models';
import type { PageResponse } from '../../data/types/api.types';

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/v1/audit-logs`;

  getAuditLogs(page = 0, size = 20, action?: string, userId?: string): Observable<PageResponse<AuditLog>> {
    let params = new HttpParams().set('page', page.toString()).set('size', size.toString());
    if (action) params = params.set('action', action);
    if (userId) params = params.set('userId', userId);
    return this.http.get<PageResponse<AuditLog>>(this.base, { params });
  }
}
