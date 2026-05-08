import {
  ChangeDetectionStrategy,
  Component,
  signal,
} from '@angular/core';
import { LogUploadComponent } from '../sniffer/upload/log-upload.component';
import { SnifferComponent } from '../sniffer/sniffer.component';

@Component({
  selector: 'app-upload-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LogUploadComponent, SnifferComponent],
  template: `
    <div class="kpit-page">

      <!-- Page header -->
      <div class="kpit-page-header">
        <div class="kpit-page-title-row">
          <div class="kpit-page-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div>
            <h1 class="kpit-page-title">Log Upload</h1>
            <p class="kpit-page-subtitle">Upload CAN log files (.txt .log .asc .blf) for analysis and playback</p>
          </div>
        </div>
      </div>

      <!-- Upload zone -->
      <div class="kpit-section">
        <div class="kpit-section-label">
          <span class="kpit-section-dot"></span>
          UPLOAD FILE
        </div>
        <div class="kpit-upload-card">
          <app-log-upload (uploadComplete)="onUploadComplete($event)"></app-log-upload>
          @if (lastUploadedSessionId()) {
            <div class="kpit-upload-success">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              File processed — session loaded below
            </div>
          }
        </div>
      </div>

      <!-- Divider -->
      <div class="kpit-divider"></div>

      <!-- Session viewer -->
      <div class="kpit-section">
        <div class="kpit-section-label">
          <span class="kpit-section-dot"></span>
          LOG SESSIONS
        </div>
        <app-sniffer
          [hideUpload]="true"
          [hideSimulator]="true"
          [uploadOnly]="true"
          [autoSelectSessionId]="lastUploadedSessionId()">
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

    /* Upload card */
    .kpit-upload-card {
      background: #0d1117;
      border: 1px solid rgba(176,255,68,0.12);
      border-radius: 12px;
      padding: 1.25rem;
      transition: border-color 0.2s;
    }
    .kpit-upload-card:hover {
      border-color: rgba(176,255,68,0.22);
    }

    /* Success message */
    .kpit-upload-success {
      display: flex; align-items: center; gap: 0.5rem;
      margin-top: 0.75rem;
      padding: 0.6rem 0.75rem;
      background: rgba(176,255,68,0.08);
      border: 1px solid rgba(176,255,68,0.20);
      border-radius: 8px;
      font-size: 0.75rem; color: #b0ff44;
    }
    .kpit-upload-success svg {
      width: 14px; height: 14px; flex-shrink: 0;
    }

    /* Divider */
    .kpit-divider {
      height: 1px;
      background: rgba(176,255,68,0.08);
      margin: 0.5rem 0 1.5rem;
    }
  `]
})
export class UploadPageComponent {
  lastUploadedSessionId = signal<string | undefined>(undefined);

  onUploadComplete(sessionId: string): void {
    this.lastUploadedSessionId.set(sessionId);
  }
}
