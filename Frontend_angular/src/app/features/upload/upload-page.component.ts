import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpEventType, HttpHeaders, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { interval } from 'rxjs';
import { API_BASE_URL } from '../../core/config/api.config';

interface Car {
  carUid: string;
  make: string;
  model: string;
  year: number;
  isVirtual: boolean;
}

interface LogHistory {
  id: number;
  sessionId: string;
  filename: string;
  status: string;
  frameCount: number;
  fileSize: number;
  createdAt: string;
}

type UploadStep = 'idle' | 'uploading' | 'processing' | 'complete' | 'error';

@Component({
  selector: 'app-upload-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, HttpClientModule, FormsModule],
  styles: [`
    .up-page { padding: 1.5rem; max-width: 960px; margin: 0 auto; }

    /* Header */
    .up-header {
      margin-bottom: 1.75rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid rgba(176,255,68,0.10);
      display: flex; align-items: center; gap: 1rem;
    }
    .up-icon {
      width: 44px; height: 44px;
      background: rgba(176,255,68,0.10);
      border: 1px solid rgba(176,255,68,0.20);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: #b0ff44; flex-shrink: 0;
    }
    .up-icon svg { width: 20px; height: 20px; }
    .up-title { font-size: 1.25rem; font-weight: 700; color: #fff; margin: 0 0 0.2rem; }
    .up-subtitle { font-size: 0.78rem; color: #8a9ab0; margin: 0; }

    /* Section label */
    .up-section { margin-bottom: 1.5rem; }
    .up-label {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.18em;
      color: #b0ff44; margin-bottom: 0.75rem;
    }
    .up-dot { width: 6px; height: 6px; border-radius: 50%; background: #b0ff44; }

    /* Vehicle select */
    .up-select {
      width: 100%; background: #161b22;
      border: 1px solid rgba(176,255,68,0.20); border-radius: 6px;
      color: #e6edf3; font-size: 0.82rem; padding: 7px 10px;
      outline: none; margin-bottom: 1rem; transition: border-color 0.2s;
    }
    .up-select:focus { border-color: rgba(176,255,68,0.5); }

    /* Drop zone */
    .up-dropzone {
      border: 2px dashed #30363d; border-radius: 12px;
      background: #0d1117; padding: 2.5rem 1.5rem;
      text-align: center; cursor: pointer; transition: all 0.2s;
    }
    .up-dropzone.drag-over {
      border-color: #b0ff44; background: rgba(176,255,68,0.05);
    }
    .up-dropzone.has-file { border-style: solid; border-color: rgba(176,255,68,0.4); }
    .up-drop-icon { font-size: 2rem; margin-bottom: 0.75rem; }
    .up-drop-text { font-size: 0.85rem; color: #8a9ab0; margin-bottom: 0.5rem; }
    .up-browse-btn {
      display: inline-block; padding: 6px 16px;
      background: rgba(176,255,68,0.10); border: 1px solid rgba(176,255,68,0.25);
      border-radius: 6px; color: #b0ff44; font-size: 0.78rem;
      cursor: pointer; transition: all 0.2s; margin-bottom: 0.75rem;
    }
    .up-browse-btn:hover { background: rgba(176,255,68,0.18); }
    .up-formats { font-size: 0.68rem; color: #484f58; }

    /* File preview */
    .up-file-preview {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.6rem 0.75rem; margin-top: 0.75rem;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      font-size: 0.78rem;
    }
    .up-file-name { color: #e6edf3; font-weight: 500; flex: 1; }
    .up-file-size { color: #8a9ab0; }
    .up-file-remove {
      background: transparent; border: none; color: #484f58;
      cursor: pointer; font-size: 0.8rem; padding: 0 4px;
    }
    .up-file-remove:hover { color: #ff4444; }

    /* Upload button */
    .up-submit-btn {
      width: 100%; margin-top: 1rem; padding: 12px;
      background: #b0ff44; color: #07090b;
      font-size: 0.9rem; font-weight: 700; letter-spacing: 0.04em;
      border: none; border-radius: 8px; cursor: pointer; transition: opacity 0.2s;
    }
    .up-submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .up-submit-btn:not(:disabled):hover { opacity: 0.88; }

    /* Progress pipeline */
    .up-pipeline {
      display: flex; align-items: center; gap: 0; margin: 1rem 0 0.5rem;
    }
    .up-step {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.72rem; font-weight: 600; color: #484f58;
    }
    .up-step.active { color: #b0ff44; }
    .up-step.done { color: #8a9ab0; }
    .up-step-num {
      width: 22px; height: 22px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: #21262d; font-size: 0.65rem; font-weight: 700;
      flex-shrink: 0;
    }
    .up-step.active .up-step-num { background: #b0ff44; color: #07090b; }
    .up-step.done .up-step-num { background: #2ea043; color: #fff; }
    .up-step-line { flex: 1; height: 1px; background: #21262d; margin: 0 0.5rem; }
    .up-step-line.done { background: #2ea043; }

    .up-progress-bar-wrap {
      background: #21262d; border-radius: 4px; height: 6px;
      margin: 0.5rem 0; overflow: hidden;
    }
    .up-progress-bar {
      height: 100%; background: #b0ff44; border-radius: 4px;
      transition: width 0.3s ease;
    }
    .up-progress-label { font-size: 0.72rem; color: #8a9ab0; }
    .up-error-msg { font-size: 0.75rem; color: #ff4444; margin-top: 0.5rem; }

    /* History table */
    .up-history-table {
      width: 100%; border-collapse: collapse; font-size: 0.75rem;
    }
    .up-history-table th {
      background: #161b22; color: #8a9ab0; font-weight: 600;
      padding: 6px 10px; text-align: left;
      border-bottom: 1px solid #21262d; font-size: 0.65rem;
      letter-spacing: 0.08em; text-transform: uppercase;
    }
    .up-history-table td {
      padding: 7px 10px; border-bottom: 1px solid #161b22; color: #e6edf3;
    }
    .up-history-table tr:hover td { background: #161b22; }
    .up-status-done { color: #2ea043; font-weight: 600; }
    .up-status-fail { color: #ff4444; font-weight: 600; }
    .up-status-proc { color: #b0ff44; font-weight: 600; }
    .up-action-btn {
      padding: 3px 10px; border-radius: 5px; font-size: 0.68rem; font-weight: 600;
      border: 1px solid #30363d; background: transparent;
      color: #8a9ab0; cursor: pointer; transition: all 0.2s;
    }
    .up-action-btn:hover { border-color: rgba(176,255,68,0.4); color: #b0ff44; }
    .up-action-btn.retry { border-color: rgba(255,68,68,0.3); color: #ff6666; }
    .up-action-btn.retry:hover { border-color: #ff4444; color: #ff4444; }
    .up-empty { text-align: center; color: #484f58; padding: 1.5rem; font-size: 0.78rem; }
  `],
  template: `
    <div class="up-page">

      <!-- Header -->
      <div class="up-header">
        <div class="up-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div>
          <h1 class="up-title">Log File Upload</h1>
          <p class="up-subtitle">Upload CAN log files for analysis · .log .asc .blf .txt · Max 500MB</p>
        </div>
      </div>

      <!-- VEHICLE -->
      <div class="up-section">
        <div class="up-label"><span class="up-dot"></span> VEHICLE</div>
        <select class="up-select" [(ngModel)]="selectedCarUid"
          [disabled]="step() === 'uploading' || step() === 'processing'">
          <option value="">Select vehicle for this capture</option>
          @for (car of cars(); track car.carUid) {
            <option [value]="car.carUid">
              {{ car.make }} {{ car.model }} {{ car.year }}
              {{ car.isVirtual ? '(virtual)' : '' }}
            </option>
          }
        </select>
      </div>

      <!-- DROP ZONE -->
      <div class="up-section">
        <div class="up-label"><span class="up-dot"></span> UPLOAD FILE</div>
        <div class="up-dropzone"
          [class.drag-over]="isDragOver()"
          [class.has-file]="!!selectedFile()"
          (dragover)="onDragOver($event)"
          (dragenter)="onDragEnter($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
          (click)="fileInput.click()">
          <div class="up-drop-icon">📁</div>
          <p class="up-drop-text">Drag & drop your file here</p>
          <span class="up-browse-btn">Browse Files</span>
          <p class="up-formats">.log · .asc · .blf · .txt · Max 500MB</p>
          <input #fileInput type="file"
            accept=".log,.asc,.blf,.txt"
            style="display:none"
            (change)="onFileSelected($event)">
        </div>

        @if (selectedFile()) {
          <div class="up-file-preview">
            <span>📄</span>
            <span class="up-file-name">{{ selectedFile()!.name }}</span>
            <span class="up-file-size">{{ formatSize(selectedFile()!.size) }}</span>
            <button class="up-file-remove" type="button" (click)="removeFile()">✕</button>
          </div>
        }

        <button type="button" class="up-submit-btn"
          [disabled]="!selectedFile() || step() === 'uploading' || step() === 'processing'"
          [title]="!selectedFile() ? 'Select a file first' : ''"
          (click)="upload()">
          @if (step() === 'uploading' || step() === 'processing') {
            Processing…
          } @else {
            ↑ Upload File
          }
        </button>

        @if (step() !== 'idle') {
          <!-- Pipeline steps -->
          <div class="up-pipeline">
            <div class="up-step" [class.active]="step() === 'uploading'" [class.done]="isDone('uploading')">
              <span class="up-step-num">{{ isDone('uploading') ? '✓' : '1' }}</span>
              Uploading
            </div>
            <div class="up-step-line" [class.done]="isDone('uploading')"></div>
            <div class="up-step" [class.active]="step() === 'processing'" [class.done]="isDone('processing')">
              <span class="up-step-num">{{ isDone('processing') ? '✓' : '2' }}</span>
              Processing
            </div>
            <div class="up-step-line" [class.done]="isDone('processing')"></div>
            <div class="up-step" [class.active]="step() === 'complete'" [class.done]="step() === 'complete'">
              <span class="up-step-num">{{ step() === 'complete' ? '✓' : '3' }}</span>
              Complete
            </div>
          </div>

          <!-- Progress bar (upload phase) -->
          @if (step() === 'uploading') {
            <div class="up-progress-bar-wrap">
              <div class="up-progress-bar" [style.width.%]="uploadProgress()"></div>
            </div>
            <p class="up-progress-label">{{ uploadProgress() }}% uploaded</p>
          }

          @if (step() === 'processing') {
            <p class="up-progress-label">Processing frames… polling every 2s</p>
          }

          @if (step() === 'complete') {
            <p class="up-progress-label" style="color:#2ea043">
              ✓ Complete — {{ frameCount() | number }} frames decoded
            </p>
          }

          @if (step() === 'error') {
            <p class="up-error-msg">{{ errorMsg() }}</p>
          }
        }
      </div>

      <!-- HISTORY -->
      <div class="up-section">
        <div class="up-label"><span class="up-dot"></span> UPLOAD HISTORY</div>
        <table class="up-history-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Frames</th>
              <th>Size</th>
              <th>Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @if (history().length === 0) {
              <tr><td colspan="6" class="up-empty">No uploads yet</td></tr>
            }
            @for (item of history(); track item.id) {
              <tr>
                <td>{{ item.filename }}</td>
                <td>{{ item.frameCount | number }}</td>
                <td>{{ formatSize(item.fileSize) }}</td>
                <td>{{ item.createdAt | slice:0:10 }}</td>
                <td>
                  @if (item.status === 'complete') {
                    <span class="up-status-done">✅ Done</span>
                  } @else if (item.status === 'error') {
                    <span class="up-status-fail">❌ Failed</span>
                  } @else {
                    <span class="up-status-proc">⏳ {{ item.status }}</span>
                  }
                </td>
                <td>
                  @if (item.status === 'complete' && item.sessionId) {
                    <button type="button" class="up-action-btn"
                      (click)="viewSession(item.sessionId)">
                      View
                    </button>
                  }
                  @if (item.status === 'error') {
                    <button type="button" class="up-action-btn retry"
                      (click)="retryUpload(item.id)">
                      Retry
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

    </div>
  `,
})
export class UploadPageComponent implements OnInit {
  private readonly http       = inject(HttpClient);
  private readonly router     = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // ── Vehicle ───────────────────────────────────────────────────────────────
  readonly cars = signal<Car[]>([]);
  selectedCarUid = '';

  // ── File selection ────────────────────────────────────────────────────────
  readonly selectedFile  = signal<File | null>(null);
  readonly isDragOver    = signal(false);

  // ── Upload state ──────────────────────────────────────────────────────────
  readonly step           = signal<UploadStep>('idle');
  readonly uploadProgress = signal(0);
  readonly errorMsg       = signal('');
  readonly frameCount     = signal(0);
  private currentSessionId = '';

  // ── History ───────────────────────────────────────────────────────────────
  readonly history = signal<LogHistory[]>([]);

  private pollSub: { unsubscribe(): void } | null = null;

  ngOnInit(): void {
    this.loadCars();
    this.loadHistory();
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragEnter(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) this.setFile(file);
  }

  onFileSelected(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.setFile(file);
  }

  removeFile(): void {
    this.selectedFile.set(null);
    this.step.set('idle');
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  upload(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.step.set('uploading');
    this.uploadProgress.set(0);
    this.errorMsg.set('');

    const formData = new FormData();
    formData.append('file', file);
    if (this.selectedCarUid) {
      formData.append('carUid', this.selectedCarUid);
    }

    const req = new HttpRequest(
      'POST',
      `${API_BASE_URL}/api/logs/upload`,
      formData,
      {
        headers: this.authHeaders(),
        reportProgress: true,
      }
    );

    this.http.request(req)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.uploadProgress.set(Math.round(100 * event.loaded / event.total));
          } else if (event.type === HttpEventType.Response) {
            const body = event.body as { sessionId: string };
            this.currentSessionId = body.sessionId;
            this.step.set('processing');
            this.pollProcessingStatus();
          }
        },
        error: (err) => {
          this.step.set('error');
          this.errorMsg.set(err?.error?.error ?? 'Upload failed');
        },
      });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  viewSession(sessionId: string): void {
    this.router.navigate(['/admin/sniffer'], {
      queryParams: { sessionId },
    });
  }

  retryUpload(logFileId: number): void {
    this.http
      .post<{ sessionId: string }>(
        `${API_BASE_URL}/api/logs/retry/${logFileId}`,
        {},
        { headers: this.authHeaders() }
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadHistory(),
        error: () => {},
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  isDone(s: UploadStep): boolean {
    const order: UploadStep[] = ['idle', 'uploading', 'processing', 'complete'];
    const idx = order.indexOf(this.step());
    const si = order.indexOf(s);
    return idx > si;
  }

  formatSize(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private setFile(file: File): void {
    const valid = ['.log', '.asc', '.blf', '.txt'];
    if (!valid.some(ext => file.name.toLowerCase().endsWith(ext))) {
      this.errorMsg.set('Unsupported file type. Use .log .asc .blf or .txt');
      this.step.set('error');
      return;
    }
    this.selectedFile.set(file);
    this.step.set('idle');
    this.errorMsg.set('');
  }

  private pollProcessingStatus(): void {
    this.pollSub?.unsubscribe();
    let attempts = 0;
    const poll = interval(2_000).pipe(takeUntilDestroyed(this.destroyRef));

    this.pollSub = poll.subscribe(() => {
      attempts++;
      this.http
        .get<{ status: string; frameCount: number }>(
          `${API_BASE_URL}/api/logs/status/${this.currentSessionId}`,
          { headers: this.authHeaders() }
        )
        .subscribe({
          next: (res) => {
            if (res.status === 'complete') {
              this.frameCount.set(res.frameCount ?? 0);
              this.step.set('complete');
              this.loadHistory();
              this.pollSub?.unsubscribe();
              this.pollSub = null;
            } else if (res.status === 'error') {
              this.step.set('error');
              this.errorMsg.set('Processing failed on server');
              this.pollSub?.unsubscribe();
              this.pollSub = null;
            } else if (attempts > 60) {
              this.step.set('error');
              this.errorMsg.set('Timeout — processing took too long');
              this.pollSub?.unsubscribe();
              this.pollSub = null;
            }
          },
          error: () => {
            if (attempts > 60) {
              this.step.set('error');
              this.errorMsg.set('Timeout — processing took too long');
              this.pollSub?.unsubscribe();
              this.pollSub = null;
            }
          },
        });
    });
  }

  private loadCars(): void {
    this.http
      .get<Car[]>(`${API_BASE_URL}/api/cars`, { headers: this.authHeaders() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cars) => this.cars.set(cars),
        error: () => {},
      });
  }

  private loadHistory(): void {
    this.http
      .get<LogHistory[]>(
        `${API_BASE_URL}/api/logs/history?size=10`,
        { headers: this.authHeaders() }
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (h) => this.history.set(h),
        error: () => {},
      });
  }

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('access_token');
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }
}
