import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { API_BASE_URL } from '../../core/config/api.config';

interface Car {
  carUid: string;
  make: string;
  model: string;
  year: number;
  color: string | null;
  vin: string | null;
  isVirtual: boolean;
  isActive: boolean;
  createdAt: string | null;
  sessionCount?: number;
  totalFrames?: number;
  faultRate?: number;
}

@Component({
  selector: 'app-fleet-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, HttpClientModule, FormsModule],
  template: `
    <div style="padding:1.5rem; max-width:1100px; margin:0 auto;">

      <!-- Header -->
      <div style="display:flex; align-items:center; justify-content:space-between;
        margin-bottom:1.75rem; padding-bottom:1.25rem;
        border-bottom:1px solid rgba(176,255,68,0.10);">
        <div style="display:flex; align-items:center; gap:1rem;">
          <div style="width:44px; height:44px; background:rgba(176,255,68,0.10);
            border:1px solid rgba(176,255,68,0.20); border-radius:10px;
            display:flex; align-items:center; justify-content:center; color:#b0ff44;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="1" y="11" width="22" height="9" rx="2" ry="2"/>
              <path d="M1 11l4-7h14l4 7"/>
              <circle cx="7" cy="20" r="1"/>
              <circle cx="17" cy="20" r="1"/>
            </svg>
          </div>
          <div>
            <h1 style="font-size:1.25rem; font-weight:700; color:#fff; margin:0 0 0.2rem;">Fleet Management</h1>
            <p style="font-size:0.78rem; color:#8a9ab0; margin:0;">Manage vehicles and view their CAN analysis history</p>
          </div>
        </div>
        <button style="
          display:inline-flex; align-items:center; gap:0.5rem;
          background:#b0ff44; color:#07090b;
          border:none; border-radius:8px;
          padding:9px 20px; font-size:0.82rem; font-weight:700;
          cursor:pointer; transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.85'"
          onmouseout="this.style.opacity='1'"
          (click)="openAddModal()">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Vehicle
        </button>
      </div>

      <!-- Stats row -->
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; margin-bottom:1.5rem;">
        <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:10px; padding:1rem;">
          <p style="font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:#484f58; text-transform:uppercase; margin:0 0 0.4rem;">Total Vehicles</p>
          <p style="font-size:1.75rem; font-weight:700; color:#e6edf3; margin:0;">{{ cars().length }}</p>
        </div>
        <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:10px; padding:1rem;">
          <p style="font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:#484f58; text-transform:uppercase; margin:0 0 0.4rem;">Physical</p>
          <p style="font-size:1.75rem; font-weight:700; color:#e6edf3; margin:0;">{{ physicalCount() }}</p>
        </div>
        <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:10px; padding:1rem;">
          <p style="font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:#484f58; text-transform:uppercase; margin:0 0 0.4rem;">Virtual</p>
          <p style="font-size:1.75rem; font-weight:700; color:#e6edf3; margin:0;">{{ virtualCount() }}</p>
        </div>
      </div>

      <!-- Vehicle table -->
      <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:12px; overflow:hidden;">
        <table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
          <thead>
            <tr style="background:#161b22; border-bottom:1px solid #21262d;">
              <th style="padding:10px 14px; text-align:left; color:#484f58; font-weight:700; letter-spacing:0.08em; font-size:0.65rem; text-transform:uppercase;">Vehicle</th>
              <th style="padding:10px 14px; text-align:left; color:#484f58; font-weight:700; letter-spacing:0.08em; font-size:0.65rem; text-transform:uppercase;">Year</th>
              <th style="padding:10px 14px; text-align:left; color:#484f58; font-weight:700; letter-spacing:0.08em; font-size:0.65rem; text-transform:uppercase;">VIN</th>
              <th style="padding:10px 14px; text-align:left; color:#484f58; font-weight:700; letter-spacing:0.08em; font-size:0.65rem; text-transform:uppercase;">Type</th>
              <th style="padding:10px 14px; text-align:left; color:#484f58; font-weight:700; letter-spacing:0.08em; font-size:0.65rem; text-transform:uppercase;">Status</th>
              <th style="padding:10px 14px; text-align:right; color:#484f58; font-weight:700; letter-spacing:0.08em; font-size:0.65rem; text-transform:uppercase;">Actions</th>
            </tr>
          </thead>
          <tbody>
            @if (loading()) {
              <tr><td colspan="6" style="padding:2rem; text-align:center; color:#484f58;">Loading vehicles...</td></tr>
            } @else if (cars().length === 0) {
              <tr><td colspan="6" style="padding:2rem; text-align:center; color:#484f58;">No vehicles registered yet. Add your first vehicle.</td></tr>
            }
            @for (car of cars(); track car.carUid) {
              <tr style="border-bottom:1px solid #161b22; cursor:pointer; transition:background 0.15s;"
                onmouseover="this.style.background='#161b22'"
                onmouseout="this.style.background='transparent'"
                (click)="selectCar(car)">
                <td style="padding:12px 14px;">
                  <div style="display:flex; align-items:center; gap:0.6rem;">
                    <div style="width:32px; height:32px; border-radius:8px;
                      background:rgba(176,255,68,0.08); border:1px solid rgba(176,255,68,0.15);
                      display:flex; align-items:center; justify-content:center; color:#b0ff44; flex-shrink:0;">
                      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <rect x="1" y="11" width="22" height="9" rx="2" ry="2"/>
                        <path d="M1 11l4-7h14l4 7"/>
                        <circle cx="7" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>
                      </svg>
                    </div>
                    <div>
                      <p style="color:#e6edf3; font-weight:600; margin:0;">{{ car.make }} {{ car.model }}</p>
                      @if (car.color) {
                        <p style="color:#484f58; font-size:0.68rem; margin:0;">{{ car.color }}</p>
                      }
                    </div>
                  </div>
                </td>
                <td style="padding:12px 14px; color:#8a9ab0;">{{ car.year }}</td>
                <td style="padding:12px 14px; color:#8a9ab0; font-family:monospace; font-size:0.72rem;">
                  {{ car.vin || '—' }}
                </td>
                <td style="padding:12px 14px;">
                  @if (car.isVirtual) {
                    <span style="background:rgba(130,80,255,0.15); color:#a78bfa;
                      border:1px solid rgba(130,80,255,0.3); border-radius:20px;
                      padding:2px 10px; font-size:0.68rem; font-weight:600;">Virtual</span>
                  } @else {
                    <span style="background:rgba(46,160,67,0.15); color:#3fb950;
                      border:1px solid rgba(46,160,67,0.3); border-radius:20px;
                      padding:2px 10px; font-size:0.68rem; font-weight:600;">Physical</span>
                  }
                </td>
                <td style="padding:12px 14px;">
                  @if (car.isActive) {
                    <span style="background:rgba(176,255,68,0.1); color:#b0ff44;
                      border:1px solid rgba(176,255,68,0.2); border-radius:20px;
                      padding:2px 10px; font-size:0.68rem; font-weight:600;">● Active</span>
                  } @else {
                    <span style="background:rgba(255,68,68,0.1); color:#ff6666;
                      border:1px solid rgba(255,68,68,0.2); border-radius:20px;
                      padding:2px 10px; font-size:0.68rem; font-weight:600;">○ Inactive</span>
                  }
                </td>
                <td style="padding:12px 14px; text-align:right;" (click)="$event.stopPropagation()">
                  <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.5rem;">
                    <button style="padding:4px 12px; border-radius:6px; font-size:0.68rem; font-weight:600;
                      border:1px solid #30363d; background:transparent; color:#8a9ab0; cursor:pointer;"
                      onmouseover="this.style.borderColor='rgba(176,255,68,0.3)'; this.style.color='#b0ff44'"
                      onmouseout="this.style.borderColor='#30363d'; this.style.color='#8a9ab0'"
                      (click)="openEditModal(car)">Edit</button>
                    <button style="padding:4px 12px; border-radius:6px; font-size:0.68rem; font-weight:600;
                      border:1px solid rgba(255,68,68,0.2); background:transparent; color:#ff6666; cursor:pointer;"
                      onmouseover="this.style.borderColor='#ff4444'"
                      onmouseout="this.style.borderColor='rgba(255,68,68,0.2)'"
                      (click)="deleteCar(car)">Delete</button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Sessions panel for selected car -->
      @if (selectedCar()) {
        <div style="margin-top:1.5rem; background:#0d1117; border:1px solid rgba(176,255,68,0.12); border-radius:12px; padding:1.25rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
            <h2 style="font-size:0.78rem; font-weight:700; color:#8a9ab0; letter-spacing:0.08em; text-transform:uppercase; margin:0;">
              Sessions — {{ selectedCar()!.make }} {{ selectedCar()!.model }} {{ selectedCar()!.year }}
            </h2>
            <button style="background:none; border:none; color:#484f58; cursor:pointer; font-size:0.8rem;"
              (click)="selectedCar.set(null)">✕ Close</button>
          </div>
          @if (sessionsLoading()) {
            <p style="color:#484f58; font-size:0.78rem; text-align:center; padding:1rem;">Loading sessions...</p>
          } @else if (carSessions().length === 0) {
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
                @for (s of carSessions(); track s.sessionId) {
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

      <!-- Add/Edit Modal -->
      @if (showModal()) {
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1000;
          display:flex; align-items:center; justify-content:center;"
          (click)="closeModal()">
          <div style="background:#0d1117; border:1px solid rgba(176,255,68,0.2); border-radius:16px;
            padding:1.75rem; width:460px; max-width:90vw;"
            (click)="$event.stopPropagation()">
            <h2 style="font-size:1rem; font-weight:700; color:#fff; margin:0 0 1.25rem;">
              {{ editingCar() ? 'Edit Vehicle' : 'Add Vehicle' }}
            </h2>

            <div style="display:flex; flex-direction:column; gap:0.875rem;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                <div>
                  <label style="font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:#484f58; text-transform:uppercase; display:block; margin-bottom:0.35rem;">Make *</label>
                  <input [(ngModel)]="form.make" placeholder="e.g. Toyota"
                    style="width:100%; background:#161b22; border:1px solid rgba(176,255,68,0.2);
                    border-radius:6px; color:#e6edf3; font-size:0.82rem; padding:7px 10px; outline:none; box-sizing:border-box;"
                    onfocus="this.style.borderColor='rgba(176,255,68,0.5)'"
                    onblur="this.style.borderColor='rgba(176,255,68,0.2)'"/>
                </div>
                <div>
                  <label style="font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:#484f58; text-transform:uppercase; display:block; margin-bottom:0.35rem;">Model *</label>
                  <input [(ngModel)]="form.model" placeholder="e.g. Camry"
                    style="width:100%; background:#161b22; border:1px solid rgba(176,255,68,0.2);
                    border-radius:6px; color:#e6edf3; font-size:0.82rem; padding:7px 10px; outline:none; box-sizing:border-box;"
                    onfocus="this.style.borderColor='rgba(176,255,68,0.5)'"
                    onblur="this.style.borderColor='rgba(176,255,68,0.2)'"/>
                </div>
              </div>

              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                <div>
                  <label style="font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:#484f58; text-transform:uppercase; display:block; margin-bottom:0.35rem;">Year *</label>
                  <input [(ngModel)]="form.year" type="number" placeholder="2024" min="1990" max="2030"
                    style="width:100%; background:#161b22; border:1px solid rgba(176,255,68,0.2);
                    border-radius:6px; color:#e6edf3; font-size:0.82rem; padding:7px 10px; outline:none; box-sizing:border-box;"
                    onfocus="this.style.borderColor='rgba(176,255,68,0.5)'"
                    onblur="this.style.borderColor='rgba(176,255,68,0.2)'"/>
                </div>
                <div>
                  <label style="font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:#484f58; text-transform:uppercase; display:block; margin-bottom:0.35rem;">Color</label>
                  <input [(ngModel)]="form.color" placeholder="e.g. White"
                    style="width:100%; background:#161b22; border:1px solid rgba(176,255,68,0.2);
                    border-radius:6px; color:#e6edf3; font-size:0.82rem; padding:7px 10px; outline:none; box-sizing:border-box;"
                    onfocus="this.style.borderColor='rgba(176,255,68,0.5)'"
                    onblur="this.style.borderColor='rgba(176,255,68,0.2)'"/>
                </div>
              </div>

              <div>
                <label style="font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:#484f58; text-transform:uppercase; display:block; margin-bottom:0.35rem;">VIN</label>
                <input [(ngModel)]="form.vin" placeholder="17-character VIN (optional)"
                  maxlength="17"
                  style="width:100%; background:#161b22; border:1px solid rgba(176,255,68,0.2);
                  border-radius:6px; color:#e6edf3; font-size:0.82rem; padding:7px 10px; outline:none; box-sizing:border-box; font-family:monospace;"
                  onfocus="this.style.borderColor='rgba(176,255,68,0.5)'"
                  onblur="this.style.borderColor='rgba(176,255,68,0.2)'"/>
              </div>

              <div style="display:flex; align-items:center; gap:0.75rem;">
                <input type="checkbox" [(ngModel)]="form.isVirtual" id="isVirtual"
                  style="width:16px; height:16px; accent-color:#b0ff44; cursor:pointer;"/>
                <label for="isVirtual" style="font-size:0.78rem; color:#8a9ab0; cursor:pointer;">
                  Virtual vehicle (simulator only — no physical VIN required)
                </label>
              </div>
            </div>

            @if (formError()) {
              <p style="color:#ff4444; font-size:0.75rem; margin:0.75rem 0 0;">{{ formError() }}</p>
            }

            <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:1.5rem;">
              <button style="padding:8px 20px; border-radius:8px; font-size:0.82rem;
                border:1px solid #30363d; background:transparent; color:#8a9ab0; cursor:pointer;"
                (click)="closeModal()">Cancel</button>
              <button style="padding:8px 20px; border-radius:8px; font-size:0.82rem; font-weight:700;
                background:#b0ff44; color:#07090b; border:none; cursor:pointer;"
                [disabled]="saving()"
                (click)="saveVehicle()">
                {{ saving() ? 'Saving...' : (editingCar() ? 'Save Changes' : 'Add Vehicle') }}
              </button>
            </div>
          </div>
        </div>
      }

    </div>
  `,
})
export class FleetPageComponent implements OnInit {
  private readonly http   = inject(HttpClient);
  private readonly router = inject(Router);

  readonly cars            = signal<Car[]>([]);
  readonly loading         = signal(true);
  readonly selectedCar     = signal<Car | null>(null);
  readonly carSessions     = signal<any[]>([]);
  readonly sessionsLoading = signal(false);
  readonly showModal       = signal(false);
  readonly editingCar      = signal<Car | null>(null);
  readonly saving          = signal(false);
  readonly formError       = signal('');

  readonly physicalCount = computed(() => this.cars().filter(c => !c.isVirtual).length);
  readonly virtualCount  = computed(() => this.cars().filter(c => c.isVirtual).length);

  form = { make: '', model: '', year: new Date().getFullYear(), color: '', vin: '', isVirtual: false };

  ngOnInit(): void { this.loadCars(); }

  loadCars(): void {
    this.loading.set(true);
    this.http.get<Car[]>(`${API_BASE_URL}/api/cars`, { headers: this.authHeaders() })
      .subscribe({ next: cars => { this.cars.set(cars); this.loading.set(false); }, error: () => this.loading.set(false) });
  }

  selectCar(car: Car): void {
    this.selectedCar.set(car);
    this.sessionsLoading.set(true);
    this.carSessions.set([]);
    this.http.get<any[]>(`${API_BASE_URL}/api/cars/${car.carUid}/sessions`, { headers: this.authHeaders() })
      .subscribe({ next: s => { this.carSessions.set(s); this.sessionsLoading.set(false); }, error: () => this.sessionsLoading.set(false) });
  }

  analyseSession(sessionId: string): void {
    this.router.navigate(['/admin/sniffer'], { queryParams: { sessionId } });
  }

  openAddModal(): void {
    this.editingCar.set(null);
    this.form = { make: '', model: '', year: new Date().getFullYear(), color: '', vin: '', isVirtual: false };
    this.formError.set('');
    this.showModal.set(true);
  }

  openEditModal(car: Car): void {
    this.editingCar.set(car);
    this.form = { make: car.make, model: car.model, year: car.year, color: car.color || '', vin: car.vin || '', isVirtual: car.isVirtual };
    this.formError.set('');
    this.showModal.set(true);
  }

  closeModal(): void { this.showModal.set(false); this.editingCar.set(null); }

  saveVehicle(): void {
    if (!this.form.make.trim() || !this.form.model.trim() || !this.form.year) {
      this.formError.set('Make, Model, and Year are required.'); return;
    }
    this.saving.set(true);
    this.formError.set('');
    const body = { make: this.form.make.trim(), model: this.form.model.trim(), year: this.form.year, color: this.form.color || null, vin: this.form.vin || null, isVirtual: this.form.isVirtual };
    const editing = this.editingCar();
    const req = editing
      ? this.http.put<Car>(`${API_BASE_URL}/api/cars/${editing.carUid}`, body, { headers: this.authHeaders() })
      : this.http.post<Car>(`${API_BASE_URL}/api/cars`, body, { headers: this.authHeaders() });
    req.subscribe({
      next: () => { this.saving.set(false); this.closeModal(); this.loadCars(); },
      error: err => { this.saving.set(false); this.formError.set(err?.error?.message || 'Save failed.'); }
    });
  }

  deleteCar(car: Car): void {
    if (!confirm(`Delete ${car.make} ${car.model} ${car.year}? This cannot be undone.`)) return;
    this.http.delete(`${API_BASE_URL}/api/cars/${car.carUid}`, { headers: this.authHeaders() })
      .subscribe({ next: () => { this.loadCars(); if (this.selectedCar()?.carUid === car.carUid) this.selectedCar.set(null); }, error: () => {} });
  }

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('access_token');
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }
}
