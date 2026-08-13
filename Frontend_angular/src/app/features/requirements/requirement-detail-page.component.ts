import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RequirementService } from '../../core/services/requirement.service';
import {
  RequirementFileDetail,
  RequirementRule,
} from '../../core/models/requirement.model';
import { AuthStore } from '../../core/store/auth.store';
import { RequirementEditTabComponent } from './requirement-edit-tab.component';

type PageMode = 'view' | 'edit' | 'source';

/**
 * Requirement-set detail — View (parsed rules) / Edit (structured editor) /
 * Source (editable YAML, validated server-side on save).
 *
 * Works both as a routed page (/admin/requirements/:filename) and embedded
 * inside the vehicle detail page's Requirements tab ([fileOverride] +
 * [embedded]).
 */
@Component({
  selector: 'app-requirement-detail-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RequirementEditTabComponent],
  styles: [`
    :host { display: block; }
    .rq-wrap {
      padding: 1.25rem; min-height: 100%;
      color: var(--kpit-body, #e6edf3);
      font-family: var(--kpit-font-sans, 'IBM Plex Sans', system-ui, sans-serif);
      font-size: 13px;
    }
    .rq-wrap--embedded { padding: 0; }

    .head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .back {
      background: none; border: none; color: #8a9ab0; cursor: pointer; font-size: 13px;
      padding: 0; display: flex; align-items: center; gap: 0.3rem; font-family: inherit;
    }
    .back:hover { color: #b0ff44; }
    .title { font-size: 15px; font-weight: 700; color: #ffffff; margin: 0; }
    .file { font-size: 12px; color: #8a9ab0; font-family: var(--kpit-font-mono, monospace); }

    .seg {
      margin-left: auto; display: flex; background: #0d1117; border-radius: 8px;
      border: 1px solid #21262d; padding: 3px; gap: 2px;
    }
    .seg button {
      padding: 6px 16px; font-size: 12.5px; font-weight: 600; border-radius: 6px;
      background: none; border: none; color: #8a9ab0; cursor: pointer; font-family: inherit;
    }
    .seg button:hover { color: #e6edf3; }
    .seg button.active { background: rgba(176,255,68,0.12); color: #b0ff44; }

    .banner {
      padding: 0.5rem 0.8rem; border-radius: 8px; font-size: 12.5px; margin-bottom: 0.9rem;
    }
    .banner--error { background: rgba(255,68,68,0.1); color: #ff4444; border: 1px solid rgba(255,68,68,0.25); }
    .banner--ok { background: rgba(63,185,80,0.1); color: #3fb950; border: 1px solid rgba(63,185,80,0.25); }

    .meta-card {
      background: #0d1117; border: 1px solid #21262d; border-radius: 8px;
      padding: 0.75rem 1rem; margin-bottom: 0.9rem; display: flex; gap: 1.25rem; flex-wrap: wrap;
      font-size: 12.5px; color: #8a9ab0;
    }
    .meta-card strong { color: #e6edf3; font-family: var(--kpit-font-mono, monospace); }

    .rule-card {
      background: #0d1117; border: 1px solid #21262d; border-radius: 8px;
      margin-bottom: 0.65rem; overflow: hidden;
    }
    .rule-head {
      display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; cursor: pointer;
      width: 100%; background: transparent; border: none; text-align: left;
      padding: 0.8rem 1rem; color: inherit; font-family: inherit; font-size: inherit;
    }
    .rule-head:hover { background: rgba(255,255,255,0.02); }
    .rule-id {
      font-family: var(--kpit-font-mono, monospace); font-size: 12px; font-weight: 700;
      color: #b0ff44; background: rgba(176,255,68,0.1); padding: 2px 8px; border-radius: 4px;
    }
    .rule-title {
      font-size: 13px; color: #e6edf3; flex: 1; min-width: 160px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .chip {
      padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700;
      letter-spacing: 0.05em; white-space: nowrap;
    }
    .chip-kind { background: rgba(88,166,255,0.12); color: #58a6ff; }
    .chip-draft { background: rgba(138,154,176,0.15); color: #8a9ab0; }
    .sev-CRITICAL { background: rgba(255,68,68,0.18); color: #ff4444; }
    .sev-HIGH { background: rgba(255,140,66,0.15); color: #ff8c42; }
    .sev-MEDIUM { background: rgba(227,179,65,0.14); color: #e3b341; }
    .sev-LOW { background: rgba(88,166,255,0.12); color: #58a6ff; }
    .sev-INFO { background: rgba(138,154,176,0.15); color: #8a9ab0; }

    .rule-body {
      padding: 0.6rem 1rem 0.8rem; display: flex; flex-direction: column; gap: 0.35rem;
      border-top: 1px solid #161b22;
    }
    .kv { font-size: 12.5px; color: #8a9ab0; }
    .kv strong { color: #e6edf3; font-weight: 600; }
    .kv code {
      font-family: var(--kpit-font-mono, monospace); font-size: 12px; color: #b0ff44;
      background: rgba(176,255,68,0.06); padding: 1px 5px; border-radius: 3px;
      overflow-wrap: anywhere;
    }
    .check-list { margin: 0.2rem 0 0; padding-left: 1.1rem; }
    .check-list li { font-size: 12.5px; color: #8a9ab0; margin-bottom: 0.15rem; }

    .src-wrap { display: flex; flex-direction: column; gap: 0.6rem; }
    .src-editor {
      width: 100%; min-height: 60vh; resize: vertical; background: #0d1117;
      border: 1px solid #21262d; border-radius: 8px; padding: 0.9rem 1rem;
      color: #e6edf3; font-family: var(--kpit-font-mono, monospace); font-size: 12.5px;
      line-height: 1.55; outline: none; white-space: pre; overflow-wrap: normal; overflow-x: auto;
    }
    .src-editor:focus { border-color: rgba(176,255,68,0.4); }
    .src-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    .btn {
      padding: 7px 16px; border-radius: 7px; font-size: 12.5px; font-weight: 700;
      cursor: pointer; border: 1px solid #b0ff44; background: #b0ff44; color: #07090b;
      font-family: inherit;
    }
    .btn:hover:not(:disabled) { opacity: 0.88; }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .btn-ghost { background: transparent; border-color: #21262d; color: #8a9ab0; font-weight: 600; }
    .btn-ghost:hover:not(:disabled) { opacity: 1; border-color: rgba(176,255,68,0.3); color: #e6edf3; }

    .empty { color: #8a9ab0; font-size: 13px; padding: 2rem 0; text-align: center; }
    .spinner {
      width: 18px; height: 18px; border: 2px solid #21262d; border-top-color: #b0ff44;
      border-radius: 50%; animation: spin 0.8s linear infinite; margin: 2rem auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    button:focus-visible, textarea:focus-visible {
      outline: 2px solid rgba(176,255,68,0.4); outline-offset: 1px;
    }
  `],
  template: `
    <div class="rq-wrap" [class.rq-wrap--embedded]="embedded">
    <div class="head">
      @if (!embedded) {
        <button class="back" (click)="goBack()">← Requirement Sets</button>
      }
      @if (embedded && mode() !== 'view') {
        <button class="back" (click)="mode.set('view')">← Back to the list</button>
      }
      <div>
        <h1 class="title">{{ detail()?.name || filename() }}</h1>
        <span class="file">{{ filename() }}
          @if (detail()?.version) { · v{{ detail()!.version }} }
        </span>
      </div>
      <div class="seg" role="group" aria-label="Requirement-set mode">
        <button [class.active]="mode() === 'view'" (click)="mode.set('view')">View</button>
        @if (canWrite() && detail()) {
          <button [class.active]="mode() === 'edit'" (click)="mode.set('edit')">Edit</button>
        }
        <button [class.active]="mode() === 'source'" (click)="mode.set('source')">Source</button>
      </div>
    </div>

    @if (banner()) {
      <div class="banner" [class.banner--error]="bannerIsError()" [class.banner--ok]="!bannerIsError()">
        {{ banner() }}
      </div>
    }

    @if (loading()) {
      <div class="spinner"></div>
    } @else if (mode() === 'view') {
      @if (detail(); as d) {
        <div class="meta-card">
          <span><strong>{{ d.rules.length }}</strong> rules</span>
          <span><strong>{{ draftCount() }}</strong> draft</span>
          <span><strong>{{ d.derivedSignals.length }}</strong> derived signals</span>
          @if (d.derivedSignals.length > 0) {
            <span>Derived:
              @for (ds of d.derivedSignals; track ds.name) {
                <strong>{{ ds.name }}</strong>{{ !$last ? ', ' : '' }}
              }
            </span>
          }
        </div>

        @for (rule of d.rules; track rule.id) {
          <div class="rule-card">
            <button class="rule-head" type="button" (click)="toggle(rule.id)"
                    [attr.aria-expanded]="expanded().has(rule.id)">
              <span class="rule-id">{{ rule.id }}</span>
              <span class="rule-title">{{ rule.title }}</span>
              <span class="chip chip-kind">{{ rule.kind }}</span>
              <span class="chip" [class]="'chip sev-' + rule.severity">{{ rule.severity }}</span>
              @if (rule.draft) { <span class="chip chip-draft">DRAFT</span> }
            </button>
            @if (expanded().has(rule.id)) {
              <div class="rule-body">
                @if (rule.preconditions.length > 0) {
                  <div class="kv"><strong>Preconditions:</strong>
                    @for (p of rule.preconditions; track p.raw) { <code>{{ p.raw }}</code> }
                  </div>
                }
                @if (rule.whileConds.length > 0) {
                  <div class="kv"><strong>While / when:</strong>
                    @for (p of rule.whileConds; track p.raw) { <code>{{ p.raw }}</code> }
                  </div>
                }
                @if (rule.trigger; as t) {
                  <div class="kv"><strong>Trigger:</strong>
                    <code>{{ t.signal }}{{ t.from ? ' from ' + t.from : '' }}{{ t.to ? ' → ' + t.to : '' }}</code>
                  </div>
                }
                @if (rule.forbidden; as f) {
                  <div class="kv"><strong>Forbidden:</strong>
                    <code>{{ f.signal }}{{ f.from ? ' from ' + f.from : '' }}{{ f.to ? ' → ' + f.to : '' }}</code>
                  </div>
                }
                @if (rule.expect; as e) {
                  <div class="kv"><strong>Expect:</strong>
                    <code>{{ e.signal }} becomes {{ e.becomes }}</code>
                  </div>
                }
                @if (rule.expectAll.length > 0) {
                  <div class="kv"><strong>Expect all:</strong>
                    @for (p of rule.expectAll; track p.raw) { <code>{{ p.raw }}</code> }
                  </div>
                }
                @if (rule.deadlineMs != null) {
                  <div class="kv"><strong>Deadline:</strong> {{ rule.deadlineMs }} ms
                    @if (rule.tolerancePct != null) { (+{{ rule.tolerancePct }}% tolerance) }
                  </div>
                }
                @if (rule.durationMs != null) {
                  <div class="kv"><strong>Duration:</strong> {{ rule.durationMs }} ms</div>
                }
                @if (rule.windowMs != null) {
                  <div class="kv"><strong>Window:</strong> {{ rule.windowMs }} ms</div>
                }
                @if (rule.stateSignal) {
                  <div class="kv"><strong>State machine:</strong> <code>{{ rule.stateSignal }}</code>
                    @for (t of rule.allowedTransitions; track $index) {
                      <code>{{ t.from }} → {{ t.to }}</code>
                    }
                  </div>
                }
                @if (rule.component) {
                  <div class="kv"><strong>Component:</strong> <code>{{ rule.component }}</code></div>
                }
                @if (rule.checkList.length > 0) {
                  <div class="kv"><strong>Check steps:</strong>
                    <ul class="check-list">
                      @for (c of rule.checkList; track c) { <li>{{ c }}</li> }
                    </ul>
                  </div>
                }
              </div>
            }
          </div>
        }
      } @else {
        <div class="empty">
          This file could not be parsed — fix it in the Source tab.
        </div>
      }
    } @else if (mode() === 'edit') {
      <app-requirement-edit-tab
        [filename]="filename()"
        [detail]="detail()"
        (saved)="refreshDetail()" />
    } @else {
      <div class="src-wrap">
        <textarea class="src-editor" [(ngModel)]="sourceYaml" spellcheck="false"
                  [readonly]="!canWrite()"></textarea>
        @if (canWrite()) {
          <div class="src-actions">
            <button class="btn btn-ghost" (click)="reloadSource()">Discard changes</button>
            <button class="btn" [disabled]="saving()" (click)="saveSource()">
              {{ saving() ? 'Saving…' : 'Validate & Save' }}
            </button>
          </div>
        }
      </div>
    }
    </div>
  `,
})
export class RequirementDetailPageComponent implements OnInit {
  private requirementService = inject(RequirementService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authStore = inject(AuthStore);

  /** True when hosted inside the vehicle detail page (hides the back link). */
  @Input() embedded = false;

  /** Filename supplied by a host page instead of the route parameter. */
  @Input() set fileOverride(value: string) {
    if (!value || value === this.filename()) return;
    this.filename.set(value);
    this.mode.set('view');
    this.banner.set('');
    this.loadAll();
  }

  /** Emitted after any successful save (host shows a toast / refreshes lists). */
  @Output() saved = new EventEmitter<void>();

  readonly filename = signal('');
  readonly detail = signal<RequirementFileDetail | null>(null);
  readonly mode = signal<PageMode>('view');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly banner = signal('');
  readonly bannerIsError = signal(false);
  readonly expanded = signal<Set<string>>(new Set());
  sourceYaml = '';

  readonly draftCount = computed(
    () => this.detail()?.rules.filter((r: RequirementRule) => r.draft).length ?? 0
  );

  readonly canWrite = computed(() => {
    const isAdmin = this.authStore.user()?.roles?.some(
      (r) => ['ADMIN', 'ROLE_ADMIN'].includes((r.name ?? '').trim().toUpperCase())
    ) ?? false;
    return isAdmin || this.authStore.hasPermission('requirement:write');
  });

  ngOnInit(): void {
    // The embedded host sets the filename through [fileOverride] (which already
    // loaded); the routed page reads it from the URL.
    if (!this.filename()) {
      this.filename.set(this.route.snapshot.paramMap.get('filename') ?? '');
      this.loadAll();
    }
  }

  private loadAll(): void {
    const filename = this.filename();
    if (!filename) return;
    this.loading.set(true);
    // ?mode=edit (create-new flow) opens the structured editor directly.
    const wantsEdit = this.route.snapshot.queryParamMap.get('mode') === 'edit';
    this.requirementService.getParsed(filename).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
        if (wantsEdit && this.canWrite()) {
          this.mode.set('edit');
        }
      },
      error: () => {
        // Unparseable files 404 on the parsed endpoint — still editable as source.
        this.detail.set(null);
        this.mode.set('source');
        this.loading.set(false);
      },
    });
    this.reloadSource();
  }

  reloadSource(): void {
    this.requirementService.getSource(this.filename()).subscribe({
      next: (source) => { this.sourceYaml = source.yaml; },
      error: () => this.showBanner('Could not load YAML source.', true),
    });
  }

  saveSource(): void {
    this.saving.set(true);
    this.requirementService.saveSource(this.filename(), this.sourceYaml).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.showBanner(`Saved — ${saved.ruleCount} rules parsed OK.`, false);
        this.requirementService.getParsed(this.filename()).subscribe({
          next: (detail) => this.detail.set(detail),
          error: () => this.detail.set(null),
        });
        this.saved.emit();
      },
      error: (err) => {
        this.saving.set(false);
        this.showBanner(err?.error?.error || 'Save failed — file rejected.', true);
      },
    });
  }

  /** Re-fetch the parsed detail + source after a structured-edit save. */
  refreshDetail(): void {
    this.requirementService.getParsed(this.filename()).subscribe({
      next: (detail) => this.detail.set(detail),
      error: () => this.detail.set(null),
    });
    this.reloadSource();
    this.saved.emit();
  }

  toggle(ruleId: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      next.has(ruleId) ? next.delete(ruleId) : next.add(ruleId);
      return next;
    });
  }

  goBack(): void {
    // The car page passes its own URL (?car=<uid> included) so Back returns
    // there with the same car selected; otherwise fall back to the list.
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    this.router.navigateByUrl(returnUrl || '/admin/requirements');
  }

  private showBanner(message: string, isError: boolean): void {
    this.banner.set(message);
    this.bannerIsError.set(isError);
  }
}
