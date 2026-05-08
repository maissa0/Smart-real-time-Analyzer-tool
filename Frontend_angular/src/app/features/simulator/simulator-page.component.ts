import {
  ChangeDetectionStrategy,
  Component,
  signal,
} from '@angular/core';
import { SimulatorControlComponent } from '../sniffer/simulator/simulator-control.component';
import { SnifferComponent } from '../sniffer/sniffer.component';

@Component({
  selector: 'app-simulator-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SimulatorControlComponent, SnifferComponent],
  template: `
    <div class="kpit-page">

      <!-- Page header -->
      <div class="kpit-page-header">
        <div class="kpit-page-title-row">
          <div class="kpit-page-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
          <div>
            <h1 class="kpit-page-title">CAN Simulator</h1>
            <p class="kpit-page-subtitle">Generate and monitor synthetic CAN bus traffic in real time</p>
          </div>
        </div>
      </div>

      <!-- Simulator controls -->
      <div class="kpit-section">
        <div class="kpit-section-label">
          <span class="kpit-section-dot"></span>
          SIMULATOR CONTROLS
        </div>
        <div class="kpit-sim-card">
          <app-simulator-control
            (simulatorStarted)="onSimulatorStarted()"
            (simulatorStopped)="onSimulatorStopped()">
          </app-simulator-control>
        </div>
      </div>

      <!-- Divider -->
      <div class="kpit-divider"></div>

      <!-- Session viewer -->
      <div class="kpit-section">
        <div class="kpit-section-label">
          <span class="kpit-section-dot"></span>
          LIVE SESSIONS
        </div>
        <app-sniffer
          [hideUpload]="true"
          [hideSimulator]="true"
          [liveOnly]="true"
          [autoSelectLive]="autoSelectLive()">
        </app-sniffer>
      </div>

    </div>
  `,
  styles: [`
    .kpit-page {
      padding: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* Header */
    .kpit-page-header {
      margin-bottom: 2rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid rgba(176,255,68,0.10);
    }
    .kpit-page-title-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .kpit-page-icon {
      width: 44px; height: 44px;
      background: rgba(176,255,68,0.10);
      border: 1px solid rgba(176,255,68,0.20);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: #b0ff44;
      flex-shrink: 0;
    }
    .kpit-page-icon svg { width: 20px; height: 20px; }
    .kpit-page-title {
      font-size: 1.25rem; font-weight: 700;
      color: #fff; margin: 0 0 0.2rem;
      letter-spacing: 0.02em;
    }
    .kpit-page-subtitle {
      font-size: 0.78rem; color: #8a9ab0; margin: 0;
    }

    /* Sections */
    .kpit-section { margin-bottom: 1.5rem; }
    .kpit-section-label {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.65rem; font-weight: 700;
      letter-spacing: 0.18em; color: #b0ff44;
      margin-bottom: 0.75rem;
      text-transform: uppercase;
    }
    .kpit-section-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #b0ff44; flex-shrink: 0;
    }

    /* Simulator card */
    .kpit-sim-card {
      background: #0d1117;
      border: 1px solid rgba(176,255,68,0.12);
      border-radius: 12px;
      padding: 1.25rem;
      transition: border-color 0.2s;
    }
    .kpit-sim-card:hover {
      border-color: rgba(176,255,68,0.22);
    }

    /* Divider */
    .kpit-divider {
      height: 1px;
      background: rgba(176,255,68,0.08);
      margin: 0.5rem 0 1.5rem;
    }
  `]
})
export class SimulatorPageComponent {
  autoSelectLive = signal(false);

  onSimulatorStarted(): void {
    setTimeout(() => this.autoSelectLive.set(true), 3000);
  }

  onSimulatorStopped(): void {
    this.autoSelectLive.set(false);
  }
}
