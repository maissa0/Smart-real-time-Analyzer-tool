import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';

export interface SignalDiff {
  signalName: string;
  meanA: number; stddevA: number; countA: number;
  meanB: number; stddevB: number; countB: number;
  meanDeltaPct: number;
  stddevRatio: number;
  changeTag: 'STABLE' | 'SHIFTED' | 'VOLATILE' | 'BOTH_CHANGED';
  /** Seconds from session start where A and B first differ; null = never/unknown. */
  divergedAtSec: number | null;
}

/** One requirement rule's outcome in each session (N/A when not evaluated). */
export interface RuleOutcomeDiff {
  ruleId: string;
  title: string;
  severity: string;
  outcomeA: string;
  outcomeB: string;
  changed: boolean;
}

export interface SessionCompareResult {
  sessionIdA: string; sessionIdB: string;
  filenameA: string;  filenameB: string;
  vehicleA: string;   vehicleB: string;
  diffs: SignalDiff[];
  onlyInA: string[];  onlyInB: string[];
  ruleDiffs: RuleOutcomeDiff[];
  analysis: string;
  modelUsed: string;
  generatedAt: string;
}

export interface SessionOption {
  sessionId: string;
  sourceFilename: string;
  status: string;
  frameCount: number;
}

@Injectable({ providedIn: 'root' })
export class SessionCompareService {
  private http = inject(HttpClient);

  getSessions(): Observable<SessionOption[]> {
    // Absolute URL + the real endpoint: relative '/api/...' hit the dev server
    // (404, nothing in the backend log) and '/sessions/all' never existed.
    return this.http.get<SessionOption[]>(`${API_BASE_URL}/api/can/sessions`);
  }

  compare(sessionIdA: string, sessionIdB: string): Observable<SessionCompareResult> {
    return this.http.post<SessionCompareResult>(
      `${API_BASE_URL}/api/sessions/compare`, { sessionIdA, sessionIdB });
  }
}