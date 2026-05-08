import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import { SnifferComponent } from '../sniffer/sniffer.component';

@Component({
  selector: 'app-monitor-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SnifferComponent],
  template: `
    <div class="kpit-page">

      <!-- Page header -->
      <div class="kpit-page-header">
        <div class="kpit-page-title-row">
          <div class="kpit-page-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div>
            <h1 class="kpit-page-title">Live Monitor</h1>
            <p class="kpit-page-subtitle">Real-time CAN bus monitoring from active simulator or hardware</p>
          </div>
          <!-- Live indicator -->
          <div class="kpit-live-badge">
            <span class="kpit-live-dot"></span>
            LIVE
          </div>
        </div>
      </div>

      <!-- Live session viewer -->
      <div class="kpit-section">
        <div class="kpit-section-label">
          <span class="kpit-section-dot"></span>
          ACTIVE SESSIONS
        </div>
        <app-sniffer
          [hideUpload]="true"
          [hideSimulator]="true"
          [liveOnly]="true">
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
    }
    .kpit-page-subtitle {
      font-size: 0.78rem; color: #8a9ab0; margin: 0;
    }
    .kpit-live-badge {
      display: flex; align-items: center; gap: 0.4rem;
      margin-left: auto;
      background: rgba(176,255,68,0.10);
      border: 1px solid rgba(176,255,68,0.25);
      border-radius: 20px;
      padding: 4px 12px;
      font-size: 0.7rem; font-weight: 700;
      letter-spacing: 0.12em; color: #b0ff44;
    }
    .kpit-live-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #b0ff44;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }
    .kpit-section { margin-bottom: 1.5rem; }
    .kpit-section-label {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.65rem; font-weight: 700;
      letter-spacing: 0.18em; color: #b0ff44;
      margin-bottom: 0.75rem;
    }
    .kpit-section-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #b0ff44;
    }
  `]
})
export class MonitorPageComponent {}
