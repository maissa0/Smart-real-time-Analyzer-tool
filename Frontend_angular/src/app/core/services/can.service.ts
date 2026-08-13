import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CanSession, CanFrame, FullReport, IntegrityFault, IntegritySummary, DiagnosticReport, FindingCluster } from '../models/can.model';
import { API_BASE_URL } from '../config/api.config';

export interface Car {
  carUid: string;
  make: string;
  model: string;
  year: number;
  isVirtual: boolean;
}

// getFrames() returns a bare array when faultsOnly/anomalyOnly filters are set,
// or a Spring Page envelope otherwise — callers narrow with Array.isArray(data).
export interface CanFramePage {
  content: CanFrame[];
  last: boolean;
  totalPages: number;
}

export interface SessionFrameMetadata {
  sessionId: string;
  msgIds: string[];
  buses: string[];
  messages: { msgId: string; msgName: string }[];
  signalNames: string[];
}

@Injectable({ providedIn: 'root' })
export class CanService {
  private http = inject(HttpClient);
  private base = `${API_BASE_URL}/api/can`;
  private carsBase = `${API_BASE_URL}/api/cars`;

  getCars(): Observable<Car[]> {
    return this.http.get<Car[]>(this.carsBase);
  }

  getSessionsByCar(carUid: string): Observable<CanSession[]> {
    return this.http.get<CanSession[]>(`${this.carsBase}/${carUid}/sessions`);
  }

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
    filters?: { msgId?: string; bus?: string; faultsOnly?: boolean; anomalyOnly?: boolean },
    page = 0,
    size = 500
  ): Observable<CanFrame[] | CanFramePage> {
    const params = new URLSearchParams();
    if (filters?.msgId)       params.set('msgId', filters.msgId);
    if (filters?.bus)         params.set('bus', filters.bus);
    if (filters?.faultsOnly)  params.set('faultsOnly', 'true');
    if (filters?.anomalyOnly) params.set('anomalyOnly', 'true');
    params.set('page', String(page));
    params.set('size', String(size));
    const qs = params.toString();
    return this.http.get<CanFrame[] | CanFramePage>(
      `${this.base}/sessions/${sessionId}/frames${qs ? '?' + qs : ''}`,
    );
  }

  getSessionMetadata(sessionId: string, bus?: string, msgId?: string): Observable<SessionFrameMetadata> {
    const params = new URLSearchParams();
    if (bus)   params.set('bus', bus);
    if (msgId) params.set('msgId', msgId);
    const qs = params.toString();
    return this.http.get<SessionFrameMetadata>(`${this.base}/sessions/${sessionId}/metadata${qs ? '?' + qs : ''}`);
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

  /** Phase-5 probable-root-cause clusters (2+ findings, same subsystem + window). */
  getFindingClusters(sessionId: string): Observable<FindingCluster[]> {
    return this.http.get<FindingCluster[]>(
      `${this.base}/integrity/sessions/${sessionId}/clusters`
    );
  }

  /** Subsystem-grouped diagnostic report: enriched faults + two verdicts per subsystem. */
  getDiagnosticReport(sessionId: string): Observable<DiagnosticReport> {
    return this.http.get<DiagnosticReport>(
      `${this.base}/integrity/sessions/${sessionId}/diagnostic-report`
    );
  }

  /** The unified session report — verdict + requirements + findings + clusters + summary. */
  getFullReport(sessionId: string): Observable<FullReport> {
    return this.http.get<FullReport>(
      `${this.base}/sessions/${sessionId}/full-report`
    );
  }

  uploadLog(file: File, carUid?: string): Observable<{ sessionId: string; filename: string; status: string }> {
    const formData = new FormData();
    formData.append('file', file);
    if (carUid) formData.append('carUid', carUid);
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
    /** Also stream frames with no catalogue entry (msg_name UNKNOWN) as value-less points. */
    includeUndecoded?: boolean;
  }): Observable<{ playbackId: string; sessionId: string; status: string; topic: string }> {
    return this.http.post<any>(`${API_BASE_URL}/api/playback/start`, request);
  }

  stopPlayback(playbackId: string): Observable<any> {
    return this.http.post(`${API_BASE_URL}/api/playback/stop/${playbackId}`, {});
  }

  getSignalTimeline(
    sessionId: string,
    signalName: string,
    startTs: number,
    endTs: number,
  ): Observable<Array<{ time: string; value: unknown; label: unknown }>> {
    return this.http.get<any[]>(
      `${API_BASE_URL}/api/can/influx/sessions/${sessionId}/timeline`,
      { params: { signalName, startTs: String(startTs), endTs: String(endTs) } },
    );
  }
}
