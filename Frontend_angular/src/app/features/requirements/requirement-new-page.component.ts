import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { RequirementService } from '../../core/services/requirement.service';

/**
 * Create-new-requirement-file page (Phase B of
 * docs/REQUIREMENTS_AUTHORING_PLAN.md). Reached from the Requirements page
 * ("New set") or from a car page ("Create new" — `?car=<uid>` pre-assigns the
 * file to that car). On success it jumps straight into the detail page's
 * structured Edit tab, where the car's signal context is already in scope.
 */
@Component({
  selector: 'app-requirement-new-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host { display: block; padding: 1.25rem; background: #0a0d12; min-height: 100%; }
    .back {
      background: none; border: none; color: #b0ff44; cursor: pointer; font-size: 0.78rem;
      padding: 0; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.3rem;
    }
    .back:hover { opacity: 0.75; }
    .card {
      background: #12161d; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
      padding: 1.1rem 1.25rem; max-width: 480px;
    }
    .title { font-size: 0.95rem; font-weight: 700; color: #e6edf3; margin: 0 0 0.3rem; }
    .sub { font-size: 0.72rem; color: #8a9ab0; margin: 0 0 1rem; }
    .car-pill {
      display: inline-block; font-size: 0.68rem; font-family: monospace; color: #58a6ff;
      background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.25);
      padding: 2px 8px; border-radius: 4px; margin-bottom: 0.9rem;
    }
    .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; }
    .field label { font-size: 0.62rem; color: #8a9ab0; font-weight: 700; letter-spacing: 0.05em; }
    .field input {
      background: #0d1015; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
      padding: 8px 10px; color: #e6edf3; font-size: 0.78rem;
    }
    .field input:focus { outline: 2px solid rgba(166,226,46,0.35); }
    .mono { font-family: monospace; }
    .hint { font-size: 0.64rem; color: #6b7280; }
    .error {
      font-size: 0.72rem; color: #ff6b6b; margin-bottom: 0.75rem; white-space: pre-wrap;
    }
    .actions { display: flex; gap: 0.5rem; }
    .btn {
      padding: 7px 16px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;
      cursor: pointer; border: 1px solid rgba(166,226,46,0.3);
      background: rgba(166,226,46,0.12); color: #a6e22e;
    }
    .btn:hover:not(:disabled) { background: rgba(166,226,46,0.2); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .btn-ghost { background: transparent; border-color: rgba(255,255,255,0.12); color: #8a9ab0; }
  `],
  template: `
    <button class="back" (click)="goBack()">← Requirement Sets</button>

    <div class="card">
      <h1 class="title">New requirement set</h1>
      <p class="sub">
        Creates an empty, valid YAML file — you land directly in the structured
        editor to add rules.
      </p>
      @if (carUid()) {
        <span class="car-pill">will be assigned to car {{ carUid() }}</span>
      }

      <div class="field">
        <label>FILENAME</label>
        <input class="mono" [(ngModel)]="filename" placeholder="e.g. central_locking.yaml"
               (keyup.enter)="create()" />
        <span class="hint">.yaml is appended automatically if missing.</span>
      </div>
      <div class="field">
        <label>DISPLAY NAME</label>
        <input [(ngModel)]="name" placeholder="e.g. Central locking requirements"
               (keyup.enter)="create()" />
      </div>

      @if (error()) { <div class="error">{{ error() }}</div> }

      <div class="actions">
        <button class="btn" [disabled]="creating() || !filename.trim()" (click)="create()">
          {{ creating() ? 'Creating…' : 'Create & edit' }}
        </button>
        <button class="btn btn-ghost" (click)="goBack()">Cancel</button>
      </div>
    </div>
  `,
})
export class RequirementNewPageComponent implements OnInit {
  private requirementService = inject(RequirementService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly carUid = signal<string | null>(null);
  readonly creating = signal(false);
  readonly error = signal('');

  filename = '';
  name = '';

  ngOnInit(): void {
    this.carUid.set(this.route.snapshot.queryParamMap.get('car'));
  }

  create(): void {
    let filename = this.filename.trim();
    if (!filename || this.creating()) return;
    if (!/\.(yaml|yml)$/i.test(filename)) {
      filename += '.yaml';
    }
    this.creating.set(true);
    this.error.set('');
    this.requirementService
      .createFile(filename, this.name.trim() || filename, this.carUid() ?? undefined)
      .subscribe({
        next: (saved) => {
          // Straight into the structured Edit tab (signal context now scoped
          // to the assigned car, when one was given).
          this.router.navigate(['/admin/requirements', saved.filename], {
            queryParams: { mode: 'edit' },
          });
        },
        error: (err) => {
          this.creating.set(false);
          this.error.set(this.messageOf(err, 'Could not create the file.'));
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/admin/requirements']);
  }

  private messageOf(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && typeof err.error?.error === 'string') {
      return err.error.error;
    }
    return fallback;
  }
}
