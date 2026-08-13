import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { RequirementService } from '../../core/services/requirement.service';
import { RequirementSummary } from '../../core/models/requirement.model';
import { AuthStore } from '../../core/store/auth.store';

/**
 * Requirement-set management page (Phase 3.3) — mirror of the catalog page for
 * the dynamic per-car requirement YAML files: list, upload, delete, reload,
 * valid/invalid badge, open detail.
 */
@Component({
  selector: 'app-requirements-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  styles: [`
    :host { display: block; padding: 1.25rem; background: #07090b; min-height: 100%; }

    .page-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .page-title { font-size: 1.05rem; font-weight: 700; color: #e6edf3; margin: 0; }
    .page-sub { font-size: 0.72rem; color: #8a9ab0; margin: 0.15rem 0 0; }
    .head-actions { margin-left: auto; display: flex; gap: 0.5rem; }

    .btn {
      padding: 6px 14px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;
      cursor: pointer; transition: all 0.15s; border: 1px solid rgba(176,255,68,0.25);
      background: transparent; color: #b0ff44;
    }
    .btn:hover { background: rgba(176,255,68,0.08); }
    .btn-primary { background: rgba(176,255,68,0.12); }
    .btn-primary:hover { background: rgba(176,255,68,0.2); }

    .status-line { font-size: 0.75rem; margin: 0 0 0.9rem; color: #3fb950; }
    .status-line.error { color: #ff6b6b; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.8rem; }
    .card {
      background: #0d1117; border: 1px solid rgba(176,255,68,0.1); border-radius: 10px;
      padding: 0.9rem 1rem; cursor: pointer; transition: border-color 0.15s, transform 0.15s;
      display: flex; flex-direction: column; gap: 0.45rem;
    }
    .card:hover { border-color: rgba(176,255,68,0.35); transform: translateY(-1px); }
    .card-head { display: flex; align-items: flex-start; gap: 0.5rem; }
    .card-name { font-size: 0.85rem; font-weight: 700; color: #e6edf3; flex: 1; min-width: 0; }
    .card-file { font-size: 0.68rem; color: #8a9ab0; font-family: monospace; word-break: break-all; }

    .badge {
      padding: 2px 8px; border-radius: 4px; font-size: 0.62rem; font-weight: 700;
      letter-spacing: 0.05em; white-space: nowrap;
    }
    .badge-valid { background: rgba(63,185,80,0.15); color: #3fb950; }
    .badge-invalid { background: rgba(255,68,68,0.15); color: #ff4444; }

    .card-meta { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
    .pill {
      padding: 2px 8px; border-radius: 10px; font-size: 0.65rem; font-weight: 600;
      background: rgba(176,255,68,0.08); color: #b0ff44; border: 1px solid rgba(176,255,68,0.15);
    }
    .pill-muted { background: rgba(72,79,88,0.2); color: #8a9ab0; border-color: transparent; }
    .pill-draft { background: rgba(227,179,65,0.12); color: #e3b341; border-color: transparent; }

    .card-actions { display: flex; justify-content: flex-end; margin-top: 0.2rem; }
    .btn-del {
      background: none; border: none; color: #484f58; font-size: 0.7rem; cursor: pointer;
      padding: 2px 6px; border-radius: 4px; transition: color 0.15s;
    }
    .btn-del:hover { color: #ff6b6b; }

    .empty {
      color: #8a9ab0; font-size: 0.8rem; padding: 2.5rem 0; text-align: center;
      border: 1px dashed rgba(176,255,68,0.15); border-radius: 10px;
    }
    .spinner {
      width: 18px; height: 18px; border: 2px solid #21262d; border-top-color: #b0ff44;
      border-radius: 50%; animation: spin 0.8s linear infinite; margin: 2rem auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Requirement Sets</h1>
        <p class="page-sub">
          Behavioral requirement files (YAML) assigned per car — the requirements
          engine checks each session only against its car's assigned sets.
        </p>
      </div>
      <div class="head-actions">
        @if (canWrite()) {
          <button class="btn btn-primary" (click)="fileInput.click()">⬆ Upload</button>
          <button class="btn btn-primary" (click)="newSet()">✚ New set</button>
          <button class="btn" (click)="reload()">↻ Reload</button>
        }
      </div>
      <input #fileInput type="file" accept=".yaml,.yml" hidden (change)="onFileSelected($event)" />
    </div>

    @if (statusMsg()) {
      <p class="status-line" [class.error]="statusIsError()">{{ statusMsg() }}</p>
    }

    @if (loading()) {
      <div class="spinner"></div>
    } @else if (sets().length === 0) {
      <div class="empty">
        No requirement sets yet. Upload a requirement YAML file to get started.
      </div>
    } @else {
      <div class="grid">
        @for (set of sets(); track set.filename) {
          <div class="card" (click)="openDetail(set)">
            <div class="card-head">
              <span class="card-name">{{ set.name }}</span>
              <span class="badge" [class.badge-valid]="set.active" [class.badge-invalid]="!set.active">
                {{ set.active ? 'VALID' : 'INVALID' }}
              </span>
            </div>
            <span class="card-file">{{ set.filename }}</span>
            <div class="card-meta">
              @if (set.version) { <span class="pill pill-muted">v{{ set.version }}</span> }
              <span class="pill">{{ set.ruleCount }} rules</span>
              @if (set.draftCount > 0) {
                <span class="pill pill-draft">{{ set.draftCount }} draft</span>
              }
            </div>
            @if (canWrite()) {
              <div class="card-actions">
                <button class="btn-del" (click)="remove(set, $event)">✕ Delete</button>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class RequirementsPageComponent implements OnInit {
  private requirementService = inject(RequirementService);
  private router = inject(Router);
  private authStore = inject(AuthStore);

  readonly sets = signal<RequirementSummary[]>([]);
  readonly loading = signal(true);
  readonly statusMsg = signal('');
  readonly statusIsError = signal(false);

  readonly canWrite = computed(() => {
    const isAdmin = this.authStore.user()?.roles?.some(
      (r) => ['ADMIN', 'ROLE_ADMIN'].includes((r.name ?? '').trim().toUpperCase())
    ) ?? false;
    return isAdmin || this.authStore.hasPermission('requirement:write');
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.requirementService.list().subscribe({
      next: (sets) => { this.sets.set(sets); this.loading.set(false); },
      error: () => {
        this.loading.set(false);
        this.setStatus('Could not load requirement sets.', true);
      },
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.requirementService.upload(file).subscribe({
      next: (saved) => {
        this.setStatus(`Uploaded ${saved.filename} (${saved.ruleCount} rules).`, false);
        this.load();
      },
      error: (err) =>
        this.setStatus(err?.error?.error || `Upload failed for ${file.name}.`, true),
    });
  }

  reload(): void {
    this.requirementService.reload().subscribe({
      next: (sets) => { this.sets.set(sets); this.setStatus('Requirement sets reloaded.', false); },
      error: () => this.setStatus('Reload failed.', true),
    });
  }

  remove(set: RequirementSummary, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Delete requirement set "${set.filename}"? Car assignments will be removed.`)) {
      return;
    }
    this.requirementService.delete(set.filename).subscribe({
      next: () => { this.setStatus(`Deleted ${set.filename}.`, false); this.load(); },
      error: (err) => this.setStatus(err?.error?.error || 'Delete failed.', true),
    });
  }

  openDetail(set: RequirementSummary): void {
    this.router.navigate(['/admin/requirements', set.filename]);
  }

  /** Create-new flow (Phase B) — form page, then straight into the Edit tab. */
  newSet(): void {
    this.router.navigate(['/admin/requirements/new']);
  }

  private setStatus(message: string, isError: boolean): void {
    this.statusMsg.set(message);
    this.statusIsError.set(isError);
  }
}
