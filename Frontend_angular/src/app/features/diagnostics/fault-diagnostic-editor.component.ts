import {
  ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DiagnosticKbService } from '../../core/services/diagnostic-kb.service';
import { DiagnosticRule, IntegrityFault } from '../../core/models/can.model';

interface EditForm {
  title: string;
  meaning: string;
  likelyCause: string;
  whatToCheck: string;
  severityWeight: number;
  enabled: boolean;
}

/**
 * Inline editor for the diagnostic rule a fault resolved to. Opens bound to the matched
 * rule (edit in place → PUT) and, when the fault names a signal but the matched rule is a
 * generic subsystem/default rule, can instead create a signal-specific SIGNAL-scope rule
 * (POST) so the diagnostics get more precise the more they're refined.
 */
@Component({
  selector: 'app-fault-diagnostic-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="backdrop" (click)="close()"></div>
    <div class="panel" role="dialog" aria-modal="true">
      <div class="head">
        <div>
          <div class="eyebrow">Edit Diagnostic</div>
          <div class="title">{{ fault().subsystem || 'General' }}</div>
          <div class="sub">{{ fault().signalName || fault().msgName || fault().msgId }} · {{ fault().faultType }}</div>
        </div>
        <button class="x" (click)="close()" aria-label="Close">✕</button>
      </div>

      @if (loading()) {
        <div class="state">Loading rule…</div>
      } @else if (error() && !rule()) {
        <div class="state err">{{ error() }}</div>
      } @else {
        <div class="body">
          <label class="fld">
            <span>Title</span>
            <input type="text" [(ngModel)]="form.title" placeholder="Short plain-English fault title" />
          </label>
          <label class="fld">
            <span>What it means</span>
            <textarea rows="3" [(ngModel)]="form.meaning" placeholder="Plain-English meaning for a car owner"></textarea>
          </label>
          <label class="fld">
            <span>Likely cause</span>
            <textarea rows="2" [(ngModel)]="form.likelyCause"></textarea>
          </label>
          <label class="fld">
            <span>What to check</span>
            <textarea rows="2" [(ngModel)]="form.whatToCheck"></textarea>
          </label>
          <div class="row">
            <label class="fld sm">
              <span>Severity weight</span>
              <input type="number" min="0" max="10" [(ngModel)]="form.severityWeight" />
            </label>
            <label class="chk">
              <input type="checkbox" [(ngModel)]="form.enabled" /> Enabled
            </label>
          </div>

          @if (canCreateSignalRule()) {
            <label class="chk create">
              <input type="checkbox" [(ngModel)]="createSignalRuleChecked" />
              Save as a new rule specific to <b>{{ fault().signalName }}</b>
              (instead of editing the shared {{ rule()?.scope | lowercase }} rule)
            </label>
          }

          @if (error()) { <div class="state err small">{{ error() }}</div> }

          <div class="actions">
            <button class="btn ghost" (click)="close()" [disabled]="saving()">Cancel</button>
            <button class="btn primary" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1000; display: block; }
    .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
    .panel {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(560px, 92vw); max-height: 88vh; overflow-y: auto;
      background: #0d1117; border: 1px solid rgba(176,255,68,.18); border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,.5); font-family: system-ui, sans-serif;
    }
    .head { display: flex; justify-content: space-between; align-items: flex-start;
      padding: 1rem 1.25rem; border-bottom: 1px solid rgba(176,255,68,.08); }
    .eyebrow { font-size: .6rem; font-weight: 700; letter-spacing: .16em; color: #b0ff44; text-transform: uppercase; }
    .title { font-size: 1.05rem; font-weight: 700; color: #e6edf3; margin-top: .15rem; }
    .sub { font-size: .72rem; color: #8a9ab0; margin-top: .1rem; font-family: ui-monospace, monospace; }
    .x { background: none; border: none; color: #8a9ab0; font-size: 1rem; cursor: pointer; }
    .x:hover { color: #e6edf3; }
    .state { padding: 1.5rem 1.25rem; color: #8a9ab0; font-size: .8rem; text-align: center; }
    .state.err { color: #f87171; }
    .state.small { text-align: left; padding: .5rem 0 0; }
    .body { padding: 1rem 1.25rem 1.25rem; display: flex; flex-direction: column; gap: .8rem; }
    .fld { display: flex; flex-direction: column; gap: .3rem; }
    .fld > span { font-size: .65rem; font-weight: 600; letter-spacing: .08em; color: #8a9ab0; text-transform: uppercase; }
    .fld input, .fld textarea {
      background: #07090b; border: 1px solid #21262d; border-radius: 6px; padding: .5rem .6rem;
      color: #e6edf3; font-size: .82rem; font-family: inherit; resize: vertical;
    }
    .fld input:focus, .fld textarea:focus { outline: none; border-color: rgba(176,255,68,.4); }
    .row { display: flex; gap: 1.25rem; align-items: flex-end; }
    .fld.sm { max-width: 130px; }
    .chk { display: flex; align-items: center; gap: .45rem; font-size: .78rem; color: #c9d3df; }
    .chk.create { padding: .6rem .7rem; background: rgba(176,255,68,.06); border: 1px dashed rgba(176,255,68,.25); border-radius: 8px; }
    .chk b { color: #b0ff44; }
    .actions { display: flex; justify-content: flex-end; gap: .6rem; margin-top: .4rem; }
    .btn { padding: .5rem 1rem; border-radius: 6px; font-size: .8rem; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .btn.ghost { background: transparent; border-color: #21262d; color: #8a9ab0; }
    .btn.ghost:hover { color: #e6edf3; border-color: #30363d; }
    .btn.primary { background: #b0ff44; color: #07090b; }
    .btn.primary:disabled, .btn.ghost:disabled { opacity: .5; cursor: default; }
  `],
})
export class FaultDiagnosticEditorComponent implements OnInit {
  readonly fault = input.required<IntegrityFault>();
  readonly saved = output<void>();
  readonly closed = output<void>();

  private readonly kb = inject(DiagnosticKbService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly rule = signal<DiagnosticRule | null>(null);

  /** Two-way bound to the checkbox; a plain field so [(ngModel)] can write it. */
  createSignalRuleChecked = false;

  form: EditForm = { title: '', meaning: '', likelyCause: '', whatToCheck: '', severityWeight: 3, enabled: true };

  ngOnInit(): void {
    const id = this.fault().ruleId;
    if (id == null) {
      this.loading.set(false);
      this.error.set('No diagnostic rule resolved for this fault yet.');
      return;
    }
    this.kb.getRule(id).subscribe({
      next: (r) => {
        this.rule.set(r);
        this.form = {
          title: r.title ?? '', meaning: r.meaning ?? '', likelyCause: r.likelyCause ?? '',
          whatToCheck: r.whatToCheck ?? '', severityWeight: r.severityWeight ?? 3, enabled: r.enabled,
        };
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.error.set('Failed to load the diagnostic rule.'); },
    });
  }

  canCreateSignalRule(): boolean {
    const r = this.rule();
    return !!this.fault().signalName && !!r && r.scope !== 'SIGNAL';
  }

  save(): void {
    const r = this.rule();
    if (!r) return;
    this.saving.set(true);
    this.error.set(null);
    const f = this.fault();

    if (this.createSignalRuleChecked && this.canCreateSignalRule() && f.signalName) {
      const newRule: DiagnosticRule = {
        id: null, scope: 'SIGNAL', matchKey: f.signalName, faultType: f.faultType,
        subsystem: r.subsystem, title: this.form.title, meaning: this.form.meaning,
        likelyCause: this.form.likelyCause, whatToCheck: this.form.whatToCheck,
        severityWeight: this.form.severityWeight, displayName: null, enabled: this.form.enabled,
        builtin: false, updatedBy: null,
      };
      this.kb.createRule(newRule).subscribe({ next: () => this.onSaved(), error: (e) => this.onError(e) });
      return;
    }

    const updated: DiagnosticRule = {
      ...r, title: this.form.title, meaning: this.form.meaning, likelyCause: this.form.likelyCause,
      whatToCheck: this.form.whatToCheck, severityWeight: this.form.severityWeight, enabled: this.form.enabled,
    };
    this.kb.updateRule(r.id as number, updated).subscribe({ next: () => this.onSaved(), error: (e) => this.onError(e) });
  }

  close(): void {
    this.closed.emit();
  }

  private onSaved(): void {
    this.saving.set(false);
    this.saved.emit();
  }

  private onError(e: { error?: { error?: string } }): void {
    this.saving.set(false);
    this.error.set(e?.error?.error ?? 'Save failed.');
  }
}
