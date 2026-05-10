import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CanSession, CanFrame, IntegrityFault, IntegritySummary } from '../../data/models/can.model';
import { API_BASE_URL } from '../config/api.config';

@Injectable({ providedIn: 'root' })
export class CanService {
  private http = inject(HttpClient);
  private base = `${API_BASE_URL}/api/can`;

  getSessions(): Observable<CanSession[]> {
    return this.http.get<CanSession[]>(`${this.base}/sessions`);
  }

  getSessionsPaged(page: number, size: number): Observable<{
    content: CanSession[];
    page: number;
    size: number;
    totalElements: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    return this.http.get<any>(`${this.base}/sessions?page=${page}&size=${size}`);
  }

  getUploadStatus(sessionId: string): Observable<{
    sessionId: string;
    filename: string;
    status: string;
    frameCount: number;
    fileSize: number;
    channelCount: number;
    durationSeconds: number;
    createdAt: string;
  }> {
    return this.http.get<any>(`${API_BASE_URL}/api/logs/status/${sessionId}`);
  }

  getFrames(
    sessionId: string,
    filters?: { msgId?: string; faultsOnly?: boolean; anomalyOnly?: boolean }
  ): Observable<CanFrame[]> {
    const params = new URLSearchParams();
    if (filters?.msgId)       params.set('msgId', filters.msgId);
    if (filters?.faultsOnly)  params.set('faultsOnly', 'true');
    if (filters?.anomalyOnly) params.set('anomalyOnly', 'true');
    const qs = params.toString();
    return this.http.get<CanFrame[]>(
      `${this.base}/sessions/${sessionId}/frames${qs ? '?' + qs : ''}`,
    );
  }

  getIntegritySummary(sessionId: string): Observable<IntegritySummary> {
    return this.http.get<IntegritySummary>(
      `${this.base}/integrity/sessions/${sessionId}/summary`
    );
  }

  getIntegrityFaults(sessionId: string): Observable<IntegrityFault[]> {
    return this.http.get<IntegrityFault[]>(
      `${this.base}/integrity/sessions/${sessionId}/faults`
    );
  }

  uploadLog(file: File): Observable<{ sessionId: string; filename: string; status: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const logsBase = `${API_BASE_URL}/api/logs`;
    return this.http.post<{ sessionId: string; filename: string; status: string }>(
      `${logsBase}/upload`,
      formData
    );
  }

  deleteSession(sessionId: string): Observable<any> {
    return this.http.delete(`${this.base}/sessions/${sessionId}`);
  }

  startPlayback(request: {
    sessionId: string;
    startTs: number;
    endTs: number;
    speed: number;
    signals?: string[];
  }): Observable<{ playbackId: string; sessionId: string; status: string; topic: string }> {
    return this.http.post<any>(`${API_BASE_URL}/api/playback/start`, request);
  }

  stopPlayback(playbackId: string): Observable<any> {
    return this.http.post(`${API_BASE_URL}/api/playback/stop/${playbackId}`, {});
  }
}
