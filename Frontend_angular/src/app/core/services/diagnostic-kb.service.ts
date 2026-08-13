import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DiagnosticRule } from '../models/can.model';
import { API_BASE_URL } from '../config/api.config';

/**
 * Thin client over the diagnostic knowledge-base API (`/api/diagnostics/rules`), used by
 * the inline fault editor so a fault's plain-English diagnostics can be refined in place.
 * Auth headers are attached by the app's HTTP interceptor.
 */
@Injectable({ providedIn: 'root' })
export class DiagnosticKbService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/diagnostics`;

  getRule(id: number): Observable<DiagnosticRule> {
    return this.http.get<DiagnosticRule>(`${this.base}/rules/${id}`);
  }

  createRule(rule: DiagnosticRule): Observable<DiagnosticRule> {
    return this.http.post<DiagnosticRule>(`${this.base}/rules`, rule);
  }

  updateRule(id: number, rule: DiagnosticRule): Observable<DiagnosticRule> {
    return this.http.put<DiagnosticRule>(`${this.base}/rules/${id}`, rule);
  }
}
