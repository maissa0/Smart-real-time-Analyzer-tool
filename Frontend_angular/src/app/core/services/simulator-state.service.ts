import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SimulatorStateService {
  readonly simId = signal<string | null>(null);
  readonly isRunning = signal(false);

  setRunning(simId: string): void {
    this.simId.set(simId);
    this.isRunning.set(true);
  }

  setStopped(): void {
    this.simId.set(null);
    this.isRunning.set(false);
  }
}
