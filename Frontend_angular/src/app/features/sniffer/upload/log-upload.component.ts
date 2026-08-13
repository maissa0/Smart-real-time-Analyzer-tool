import {
  Component, Input, Output, EventEmitter, signal,
  ChangeDetectionStrategy, inject, DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, switchMap, takeWhile, take } from 'rxjs';
import { CanService } from '../../../core/services/can.service';

@Component({
  selector: 'app-log-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  styles: [`
    @keyframes upload-ring-sweep {
      0% {
        stroke-dasharray: 4 100;
        stroke-dashoffset: 0;
        opacity: 1;
      }
      45% {
        stroke-dasharray: 42 100;
        stroke-dashoffset: -18;
        opacity: 1;
      }
      100% {
        stroke-dasharray: 4 100;
        stroke-dashoffset: -104;
        opacity: 0.85;
      }
    }
    @keyframes upload-ring-spin {
      to { transform: rotate(360deg); }
    }
    .upload-progress-spin {
      animation: upload-ring-spin 2.2s linear infinite;
    }
    .upload-progress-arc {
      animation: upload-ring-sweep 1.6s ease-in-out infinite;
    }
    .upload-glow {
      box-shadow: 0 0 28px -4px rgba(251, 191, 36, 0.35), inset 0 0 20px -12px rgba(251, 191, 36, 0.15);
    }
  `],
  template: `
    <div class="mb-3">
      @if (cars.length > 0) {
        <div style="margin-bottom: 0.5rem;">
          <label style="font-size:0.65rem; color:#484f58;
                         text-transform:uppercase; letter-spacing:0.08em;">
            Link to Vehicle
          </label>
          <select
            style="width:100%; margin-top:0.25rem; padding:0.3rem 0.5rem;
                   background:#161b22; border:1px solid #21262d;
                   border-radius:4px; color:#e6edf3; font-size:0.72rem;"
            [value]="selectedCarUid()"
            (change)="selectedCarUid.set($any($event.target).value)">
            <option value="">No vehicle (unlinked)</option>
            @for (car of cars; track car.carUid) {
              <option [value]="car.carUid">
                {{ car.make }} {{ car.model }} {{ car.year }}
              </option>
            }
          </select>
        </div>
      }
      <div
        class="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all"
        [class]="isDragging()
          ? 'border-blue-500 bg-blue-950/30'
          : uploading()
            ? 'border-amber-600/80 bg-amber-950/15 upload-glow cursor-default'
            : uploadError()
              ? 'border-red-600 bg-red-950/20'
              : 'border-gray-600 bg-gray-800/50 hover:border-gray-400'"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave()"
        (drop)="onDrop($event)"
        (click)="!uploading() && fileInput.click()">

        @if (uploading()) {
          <div class="flex flex-col items-center gap-3 py-2 pointer-events-none select-none">
            <div class="upload-progress-spin relative flex h-[4.25rem] w-[4.25rem] items-center justify-center">
              <svg class="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="18" fill="none" class="stroke-gray-700/80" stroke-width="2.5" />
                <circle
                  cx="22" cy="22" r="18"
                  fill="none"
                  class="upload-progress-arc stroke-amber-400"
                  stroke-width="2.75"
                  stroke-linecap="round"
                  pathLength="100"
                  stroke-dasharray="8 92"
                  stroke-dashoffset="0" />
              </svg>
            </div>
            <div class="space-y-1 text-center">
              <span class="block text-xs font-semibold uppercase tracking-[0.12em] text-amber-400/95">
                {{ uploadStatus() ?? 'Processing' }}
              </span>
              <span class="block max-w-[14rem] text-[11px] leading-snug text-gray-400">
                Decoding CAN frames and running the pipeline…
              </span>
            </div>
          </div>
        } @else if (uploadError()) {
          <div class="flex flex-col items-center gap-1 py-1">
            <span class="text-xs text-red-400">{{ uploadError() }}</span>
            <span class="text-xs text-gray-500">Click to retry</span>
          </div>
        } @else {
          <div class="flex flex-col items-center gap-1 py-1">
            <span class="text-xs text-gray-300 font-medium">Drop a log file here, or click to browse</span>
            <span class="text-xs text-gray-500" style="font-family: var(--kpit-font-mono, monospace);">.txt · .log · .asc · .blf</span>
          </div>
        }
      </div>
      <input #fileInput type="file" class="hidden"
        accept=".txt,.log,.asc,.blf"
        (change)="onFileSelected($event)">
    </div>
  `
})
export class LogUploadComponent {
  @Input() set carUid(val: string) {
    if (val) this.selectedCarUid.set(val);
  }
  @Input() cars: { carUid: string; make: string; model: string; year: number }[] = [];
  @Output() uploadComplete = new EventEmitter<string>();
  selectedCarUid = signal<string>('');

  private canService = inject(CanService);
  private destroyRef = inject(DestroyRef);

  isDragging = signal(false);
  uploading = signal(false);
  uploadError = signal<string | null>(null);
  uploadStatus = signal<string | null>(null);

  onDragOver(e: DragEvent): void { e.preventDefault(); this.isDragging.set(true); }
  onDragLeave(): void { this.isDragging.set(false); }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.upload(file);
  }

  onFileSelected(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.upload(file);
  }

  private upload(file: File): void {
    this.uploading.set(true);
    this.uploadError.set(null);
    this.uploadStatus.set('Uploading...');

    this.canService.uploadLog(file, this.selectedCarUid() || this.carUid || undefined).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (res) => {
        this.uploadStatus.set('Processing...');
        // Poll status until complete or error
        this.pollStatus(res.sessionId);
      },
      error: (err) => {
        this.uploading.set(false);
        this.uploadStatus.set(null);
        this.uploadError.set(err?.error?.error ?? 'Upload failed — check backend logs');
      }
    });
  }

  private pollStatus(sessionId: string): void {
    let settledSuccess = false;
    interval(2000).pipe(
      takeUntilDestroyed(this.destroyRef),
      switchMap(() => this.canService.getUploadStatus(sessionId)),
      takeWhile(status => status.status === 'processing' || status.status === 'pending', true),
      take(30) // max 60 seconds (30 × 2s)
    ).subscribe({
      next: (status) => {
        if (status.status === 'complete') {
          settledSuccess = true;
          this.uploadStatus.set(
            `Done — ${status.frameCount} frames · ${status.channelCount} channels · ${status.durationSeconds.toFixed(1)}s`
          );
          setTimeout(() => {
            this.uploading.set(false);
            this.uploadStatus.set(null);
            this.uploadComplete.emit(sessionId);
          }, 1500);
        } else if (status.status === 'error') {
          this.uploading.set(false);
          this.uploadStatus.set(null);
          this.uploadError.set('Processing failed — check file format');
        } else {
          this.uploadStatus.set(`Processing... ${status.frameCount ?? 0} frames so far`);
        }
      },
      error: () => {
        // Status endpoint not found yet — file_worker hasn't created record
        // Keep polling silently
      },
      complete: () => {
        // Max polls reached without completion
        if (this.uploading() && !settledSuccess) {
          this.uploading.set(false);
          this.uploadStatus.set(null);
          this.uploadComplete.emit(sessionId);
        }
      }
    });
  }
}
