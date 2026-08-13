import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SKIP_ERROR_TOAST } from '../interceptors/error.interceptor';

const API = 'http://localhost:8080';

export interface FaultPoint {
  relTimeSec: number;
  type: 'DUPLICATE' | 'TIMING_GAP' | 'SIGNAL_RANGE';
}

export interface FaultBreakdown {
  total: number;
  duplicates: number;
  timingGaps: number;
  rangeViolations: number;
  timeline: FaultPoint[];
}

export interface SignalStat {
  name: string;
  min: number;
  max: number;
  mean: number;
  count: number;
}

export interface KeyEvent {
  time: string;
  description: string;
}

export interface SessionSummary {
  sessionId:       string;
  durationSec:     number;
  narrative:       string;
  networkHealth:   string;
  faultAnalysis:   string;
  recommendations: string[];
  keyEvents:       KeyEvent[];
  healthScore:     number;
  healthGrade:     string;
  signalStats:     SignalStat[];
  faultBreakdown:  FaultBreakdown;
  modelUsed:       string;
  generatedAt:     string;
  signalCount:     number;
  errorCount:      number;
  /** Requirement rules the summary was based on (0 for legacy summaries) — staleness check. */
  ruleCount:       number;
}

@Injectable({ providedIn: 'root' })
export class SessionSummaryService {
  private http = inject(HttpClient);

  get(sessionId: string): Observable<SessionSummary> {
    return this.http.get<SessionSummary>(`${API}/api/sessions/${sessionId}/summary`);
  }

  getQuiet(sessionId: string): Observable<SessionSummary> {
    const context = new HttpContext().set(SKIP_ERROR_TOAST, true);
    return this.http.get<SessionSummary>(`${API}/api/sessions/${sessionId}/summary`, { context });
  }

  generate(sessionId: string): Observable<void> {
    return this.http.post<void>(`${API}/api/sessions/${sessionId}/summary/generate`, {});
  }
}
