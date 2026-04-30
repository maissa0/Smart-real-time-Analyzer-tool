import { Injectable } from '@angular/core';

export interface DashboardSnapshot {
  showResults:        boolean;
  activeView:         'table' | 'charts' | '3d';
  chartMode:          'grouped' | 'separate';
  allFrames:          any[];
  filteredFrames:     any[];
  msgTree:            any[];
  messageGroups:      any[];   // cards stripped of chart instances
  logStartTs:         number;
  filterAddress:      string;
  filterBus:          string;
  errorReport:        any;
  xmlFilesUsed:       string[];
  logFile:            File | null;
  logFileName:        string;
  streamingFrameCount: number;
  streamingDone:      boolean;
  analyzeMode:        'stream' | 'batch';
}

export interface PendingAnalysisResult {
  frames:       any[];
  errorReport:  any;
  xmlFilesUsed: string[];
}

@Injectable({ providedIn: 'root' })
export class DashboardStateService {
  snapshot:      DashboardSnapshot | null     = null;
  pendingResult: PendingAnalysisResult | null = null;

  clear(): void { this.snapshot = null; }
}
