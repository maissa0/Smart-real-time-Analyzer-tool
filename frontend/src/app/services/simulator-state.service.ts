import { Injectable } from '@angular/core';

export interface SimulatorSnapshot {
  simState:        'idle' | 'running' | 'paused';
  frameCount:      number;
  showResults:     boolean;
  activeView:      'table' | 'charts' | '3d';
  chartMode:       'grouped' | 'separate';
  allFrames:       any[];
  filteredFrames:  any[];
  msgTree:         any[];
  messageGroups:   any[];   // cards stripped of chart instances
  logStartTs:      number;
  filterAddress:   string;
  filterBus:       string;
  speedMultiplier: number;
}

@Injectable({ providedIn: 'root' })
export class SimulatorStateService {
  snapshot: SimulatorSnapshot | null = null;

  clear(): void { this.snapshot = null; }
}
