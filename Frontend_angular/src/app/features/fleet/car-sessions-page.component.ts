import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FleetService, Car } from './fleet.service';
import { CanSession } from '../../core/models/can.model';

@Component({
  selector: 'app-car-sessions-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div style="padding:1.5rem; max-width:1100px; margin:0 auto;">

      <!-- Header -->
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1.75rem; padding-bottom:1.25rem;
        border-bottom:1px solid rgba(176,255,68,0.10);">
        <button style="background:none; border:none; color:#8a9ab0; cursor:pointer; font-size:0.82rem;
          display:flex; align-items:center; gap:0.4rem; padding:4px 0;"
          (click)="backToFleet()">← Fleet</button>
      </div>

      @if (loading()) {
        <p style="color:#484f58; font-size:0.82rem; text-align:center; padding:2rem;">Loading vehicle...</p>
      } @else if (!car()) {
        <p style="color:#ff4444; font-size:0.82rem; text-align:center; padding:2rem;">Vehicle not found.</p>
      } @else {
        <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1.5rem;">
          <div style="width:44px; height:44px; background:rgba(176,255,68,0.10);
            border:1px solid rgba(176,255,68,0.20); border-radius:10px;
            display:flex; align-items:center; justify-content:center; color:#b0ff44; flex-shrink:0;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="1" y="11" width="22" height="9" rx="2" ry="2"/>
              <path d="M1 11l4-7h14l4 7"/>
              <circle cx="7" cy="20" r="1"/>
              <circle cx="17" cy="20" r="1"/>
            </svg>
          </div>
          <div>
            <h1 style="font-size:1.15rem; font-weight:700; color:#fff; margin:0 0 0.2rem;">
              {{ car()!.make }} {{ car()!.model }} {{ car()!.year }}
            </h1>
            <p style="font-size:0.78rem; color:#8a9ab0; margin:0;">
              {{ car()!.vin || 'No VIN' }} &bull; {{ car()!.isVirtual ? 'Virtual' : 'Physical' }}
            </p>
          </div>
        </div>

        <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:12px; padding:1.25rem;">
          <h2 style="font-size:0.78rem; font-weight:700; color:#8a9ab0; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 1rem;">
            Sessions
          </h2>
          @if (sessionsLoading()) {
            <p style="color:#484f58; font-size:0.78rem; text-align:center; padding:1rem;">Loading sessions...</p>
          } @else if (sessions().length === 0) {
            <p style="color:#484f58; font-size:0.78rem; text-align:center; padding:1rem;">No sessions found for this vehicle.</p>
          } @else {
            <table style="width:100%; border-collapse:collapse; font-size:0.75rem;">
              <thead>
                <tr style="border-bottom:1px solid #21262d;">
                  <th style="padding:6px 10px; text-align:left; color:#484f58; font-size:0.65rem; text-transform:uppercase; letter-spacing:0.08em;">Session ID</th>
                  <th style="padding:6px 10px; text-align:left; color:#484f58; font-size:0.65rem; text-transform:uppercase; letter-spacing:0.08em;">File</th>
                  <th style="padding:6px 10px; text-align:left; color:#484f58; font-size:0.65rem; text-transform:uppercase; letter-spacing:0.08em;">Frames</th>
                  <th style="padding:6px 10px; text-align:left; color:#484f58; font-size:0.65rem; text-transform:uppercase; letter-spacing:0.08em;">Status</th>
                  <th style="padding:6px 10px; text-align:left; color:#484f58; font-size:0.65rem; text-transform:uppercase; letter-spacing:0.08em;">Date</th>
                  <th style="padding:6px 10px; text-align:right; color:#484f58; font-size:0.65rem; text-transform:uppercase; letter-spacing:0.08em;"></th>
                </tr>
              </thead>
              <tbody>
                @for (s of sessions(); track s.sessionId) {
                  <tr style="border-bottom:1px solid #161b22;">
                    <td style="padding:8px 10px; font-family:monospace; font-size:0.68rem; color:#8a9ab0;">
                      {{ s.sessionId | slice:0:8 }}...
                    </td>
                    <td style="padding:8px 10px; color:#e6edf3;">{{ s.sourceFilename || '—' }}</td>
                    <td style="padding:8px 10px; color:#e6edf3;">{{ s.frameCount | number }}</td>
                    <td style="padding:8px 10px;">
                      <span [style.color]="s.status === 'COMPLETE' ? '#b0ff44' : s.status === 'ERROR' ? '#ff4444' : '#f0a500'"
                        style="font-size:0.68rem; font-weight:600;">
                        {{ s.status || 'PROCESSING' }}
                      </span>
                    </td>
                    <td style="padding:8px 10px; color:#484f58;">{{ s.createdAt | slice:0:10 }}</td>
                    <td style="padding:8px 10px; text-align:right;">
                      <button style="padding:3px 10px; border-radius:5px; font-size:0.68rem; font-weight:600;
                        border:1px solid #30363d; background:transparent; color:#8a9ab0; cursor:pointer;"
                        onmouseover="this.style.borderColor='rgba(176,255,68,0.3)'; this.style.color='#b0ff44'"
                        onmouseout="this.style.borderColor='#30363d'; this.style.color='#8a9ab0'"
                        (click)="analyseSession(s.sessionId)">Analyse →</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }
    </div>
  `,
})
export class CarSessionsPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fleetService = inject(FleetService);

  readonly car = signal<Car | null>(null);
  readonly loading = signal(true);
  readonly sessions = signal<CanSession[]>([]);
  readonly sessionsLoading = signal(true);

  ngOnInit(): void {
    const carUid = this.route.snapshot.paramMap.get('carUid');
    if (!carUid) {
      this.loading.set(false);
      return;
    }

    this.fleetService.getCar(carUid).subscribe({
      next: car => { this.car.set(car); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });

    this.fleetService.getCarSessions(carUid).subscribe({
      next: sessions => { this.sessions.set(sessions); this.sessionsLoading.set(false); },
      error: () => { this.sessionsLoading.set(false); },
    });
  }

  analyseSession(sessionId: string): void {
    this.router.navigate(['/admin/workspace/session', sessionId], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  backToFleet(): void {
    this.router.navigate(['/admin/fleet']);
  }
}
