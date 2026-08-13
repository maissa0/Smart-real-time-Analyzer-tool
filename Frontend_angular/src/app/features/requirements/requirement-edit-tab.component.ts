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
import { HttpErrorResponse } from '@angular/common/http';
import { RequirementService } from '../../core/services/requirement.service';
import {
  MetaUpdatePayload,
  NlRuleDraft,
  RequirementFileDetail,
  RequirementPredicate,
  RequirementRule,
  RuleEditPayload,
  SignalContext,
} from '../../core/models/requirement.model';

/** One predicate row: builder (signal/op/value) or raw text ("x in [1, 2]"). */
interface PredDraft {
  useRaw: boolean;
  signal: string;
  op: string;
  value: string;
  raw: string;
}

interface TransitionDraft {
  from: string;
  to: string;
}

/** Mutable working copy of one rule bound to the structured form. */
interface RuleDraft {
  /** id the rule has on disk; null = not saved yet (add instead of update). */
  originalId: string | null;
  id: string;
  title: string;
  component: string;
  severity: string;
  kind: string;
  draft: boolean;
  preconditions: PredDraft[];
  whileConds: PredDraft[];
  expectAll: PredDraft[];
  triggerSignal: string;
  triggerFrom: string;
  triggerTo: string;
  forbiddenSignal: string;
  forbiddenFrom: string;
  forbiddenTo: string;
  expectSignal: string;
  expectBecomes: string;
  deadlineMs: number | null;
  durationMs: number | null;
  windowMs: number | null;
  tolerancePct: number | null;
  stateSignal: string;
  transitions: TransitionDraft[];
  violationTitle: string;
  checkList: string[];
  open: boolean;
  saving: boolean;
  error: string;
  okMsg: string;
}

interface CaseDraft {
  value: string;
  when: PredDraft[];
}

interface DerivedDraft {
  name: string;
  fromText: string;
  cases: CaseDraft[];
}

interface SignalMapRow {
  alias: string;
  signal: string;
}

/** One bulk-converted draft awaiting accept / edit / reject (Phase D). */
interface BulkCard {
  draft: RuleDraft;
  unresolvedCount: number;
  accepted: boolean;
}

const OPS = ['==', '!=', '<', '<=', '>', '>='];
const KINDS = ['response', 'absence', 'duration', 'invariant'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * Structured Edit tab of the requirement detail page (Phase A of
 * docs/REQUIREMENTS_AUTHORING_PLAN.md) — mirror of the catalogue page's Edit
 * mode. Rules are saved one by one through the granular endpoints; the meta
 * section (name, signal_map, derived_signals) has its own save. Every signal
 * input autocompletes from the signal-context endpoint and warns when a
 * referenced signal is outside the assigned cars' catalogs.
 */
@Component({
  selector: 'app-requirement-edit-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host {
      display: block;
      font-family: var(--kpit-font-sans, 'IBM Plex Sans', system-ui, sans-serif);
    }

    .toolbar { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.9rem; }
    .spacer { flex: 1; }

    .notice {
      padding: 0.45rem 0.8rem; border-radius: 8px; font-size: 12px; margin-bottom: 0.9rem;
      background: rgba(240,165,0,0.1); color: #f0a500; border: 1px solid rgba(240,165,0,0.25);
    }

    .card {
      background: #0d1117; border: 1px solid #21262d; border-radius: 8px;
      padding: 0.8rem 1rem; margin-bottom: 0.65rem;
    }
    .card-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; cursor: pointer; }
    .rule-id {
      font-family: var(--kpit-font-mono, monospace); font-size: 12px; font-weight: 700;
      color: #b0ff44; background: rgba(176,255,68,0.1); padding: 2px 8px; border-radius: 4px;
    }
    .rule-title { font-size: 13px; color: #e6edf3; flex: 1; min-width: 160px; }
    .chip {
      padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700;
      letter-spacing: 0.05em; white-space: nowrap;
    }
    .chip-kind { background: rgba(88,166,255,0.12); color: #58a6ff; }
    .chip-draft { background: rgba(138,154,176,0.15); color: #8a9ab0; }
    .chip-new { background: rgba(227,179,65,0.14); color: #e3b341; }
    .chip-saved { background: rgba(63,185,80,0.12); color: #3fb950; }

    .form { margin-top: 0.8rem; display: flex; flex-direction: column; gap: 0.7rem; }
    .row { display: flex; gap: 0.7rem; flex-wrap: wrap; align-items: flex-end; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 110px; }
    .field--grow { flex: 1; }
    .field label {
      font-size: 10px; color: #8a9ab0; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .field input, .field select {
      background: #161b22; border: 1px solid #21262d; border-radius: 6px;
      padding: 6px 9px; color: #e6edf3; font-size: 12.5px; font-family: inherit;
      min-width: 0; max-width: 100%;
    }
    .field input:focus, .field select:focus { outline: 2px solid rgba(176,255,68,0.3); }
    .field input.mono { font-family: var(--kpit-font-mono, monospace); }

    .sec {
      border: 1px solid #21262d; border-radius: 8px; padding: 0.6rem 0.75rem;
      display: flex; flex-direction: column; gap: 0.45rem;
    }
    .sec-title {
      font-size: 10px; color: #8a9ab0; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .pred-row { display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; }
    .pred-row input, .pred-row select {
      background: #161b22; border: 1px solid #21262d; border-radius: 6px;
      padding: 6px 9px; color: #e6edf3; font-size: 12px;
      font-family: var(--kpit-font-mono, monospace); min-width: 0; max-width: 100%;
    }
    .pred-row input:focus, .pred-row select:focus { outline: 2px solid rgba(176,255,68,0.3); }
    .pred-sig { width: 220px; }
    .pred-op { width: 62px; }
    .pred-val { width: 160px; }
    .pred-raw { flex: 1; min-width: 200px; }

    .warn { font-size: 11px; color: #f0a500; }

    .labels { display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .label-chip {
      font-size: 11px; font-family: var(--kpit-font-mono, monospace); color: #58a6ff;
      cursor: pointer; background: rgba(88,166,255,0.08); border: 1px solid rgba(88,166,255,0.2);
      padding: 1px 7px; border-radius: 4px;
    }
    .label-chip:hover { background: rgba(88,166,255,0.18); }

    .btn {
      padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all 0.15s; border: 1px solid rgba(176,255,68,0.3);
      background: rgba(176,255,68,0.12); color: #b0ff44; font-family: inherit;
    }
    .btn:hover:not(:disabled) { background: rgba(176,255,68,0.2); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .btn-ghost { background: transparent; border-color: #21262d; color: #8a9ab0; }
    .btn-danger { background: transparent; border-color: rgba(255,68,68,0.3); color: #ff4444; }
    .btn-xs { padding: 3px 9px; font-size: 11px; }
    .btn-dashed {
      background: none; color: #b0ff44; border: 1px dashed rgba(176,255,68,0.3);
      font-size: 11.5px; padding: 4px 10px; border-radius: 6px; cursor: pointer;
      align-self: flex-start; font-family: inherit;
    }
    .x-btn {
      background: #161b22; color: #8a9ab0; border: 1px solid #21262d;
      border-radius: 6px; width: 26px; height: 26px; cursor: pointer; flex-shrink: 0;
    }
    .x-btn:hover { color: #ff4444; border-color: rgba(255,68,68,0.4); }

    .msg { font-size: 12px; }
    .msg--error { color: #ff4444; white-space: pre-wrap; }
    .msg--ok { color: #3fb950; }

    .chk { display: flex; align-items: center; gap: 0.35rem; font-size: 12px; color: #8a9ab0; }
    .chk input { accent-color: #b0ff44; }
    .actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }

    .meta-title { font-size: 13px; font-weight: 700; color: #ffffff; margin-bottom: 0.5rem; }
    .map-row { display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; }
    .map-row input {
      background: #161b22; border: 1px solid #21262d; border-radius: 6px;
      padding: 6px 9px; color: #e6edf3; font-size: 12px;
      font-family: var(--kpit-font-mono, monospace); min-width: 0; max-width: 100%;
    }
    .map-row input:focus { outline: 2px solid rgba(176,255,68,0.3); }
    .derived { border-left: 2px solid rgba(88,166,255,0.25); padding-left: 0.7rem; }
    .case { border-left: 2px solid rgba(176,255,68,0.2); padding-left: 0.7rem; }

    .nl-input {
      width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical;
      background: #161b22; border: 1px solid #21262d; border-radius: 8px;
      padding: 8px 10px; color: #e6edf3; font-size: 12.5px; line-height: 1.5;
      font-family: inherit;
    }
    .nl-input:focus { outline: 2px solid rgba(176,255,68,0.3); }
    .nl-hint { font-size: 11px; color: #8a9ab0; }
    .engine-chip {
      padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700;
      background: rgba(88,166,255,0.12); color: #58a6ff;
    }
    .bulk-card {
      border: 1px solid #21262d; border-radius: 8px;
      padding: 0.6rem 0.75rem; margin-bottom: 0.5rem;
    }
    .bulk-card--rejected { opacity: 0.45; }
    .bulk-source { font-size: 11.5px; color: #8a9ab0; margin-top: 0.3rem; }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
      outline: 2px solid rgba(176,255,68,0.4); outline-offset: 1px;
    }
  `],
  template: `
    <datalist id="req-signal-options">
      @for (name of signalNames(); track name) {
        <option [value]="name"></option>
      }
    </datalist>

    @if (context() && !context()!.scoped) {
      <div class="notice">
        This file is not assigned to any car yet — showing signals from ALL
        catalogs. Assign the file to a car to scope validation to its catalogs.
      </div>
    }

    <!-- ── Natural language → rule (Phase C) ────────────────────────── -->
    <div class="card">
      <div class="meta-title">Natural language → rule</div>
      <div class="form">
        <textarea class="nl-input" [(ngModel)]="nlText" spellcheck="false"
          placeholder='e.g. "When Key_Button_Status becomes Lock_Pressed, Drd_Lock must become Locked within 600 ms" — English or French'></textarea>
        <span class="nl-hint">
          The sentence (plus in-scope signal names) is sent to the configured
          LLM when available; otherwise a local pattern parser answers. The
          generated rule opens below as an UNSAVED card — review and save it.
        </span>
        <div class="actions">
          <button class="btn" [disabled]="nlBusy() || !nlText.trim()" (click)="convertNl()">
            {{ nlBusy() ? 'Converting…' : (bulkMode ? 'Convert document' : 'Convert to rule') }}
          </button>
          <label class="chk">
            <input type="checkbox" [(ngModel)]="bulkMode" />
            bulk paste (document with several requirements — needs the LLM)
          </label>
          @if (nlEngine()) { <span class="engine-chip">engine: {{ nlEngine() }}</span> }
        </div>
        @for (w of nlWarnings(); track w) { <div class="warn">{{ w }}</div> }
        @if (nlError()) { <div class="msg msg--error">{{ nlError() }}</div> }
      </div>
    </div>

    <!-- ── Bulk review (Phase D): accept / edit / reject per draft ──── -->
    @if (bulkCards.length > 0) {
      <div class="card">
        <div class="meta-title">Bulk review — {{ bulkCards.length }} draft(s)</div>
        @for (c of bulkCards; track $index; let bi = $index) {
          <div class="bulk-card" [class.bulk-card--rejected]="!c.accepted">
            <div class="card-head" style="cursor: default;">
              <span class="rule-id">{{ c.draft.id || '(no id)' }}</span>
              <span class="rule-title">{{ c.draft.title }}</span>
              <span class="chip chip-kind">{{ c.draft.kind.toUpperCase() }}</span>
              @if (c.unresolvedCount > 0) {
                <span class="chip chip-draft">{{ c.unresolvedCount }} unresolved → draft</span>
              } @else {
                <span class="chip chip-new">signals resolved</span>
              }
              <span class="spacer"></span>
              <button class="btn btn-ghost btn-xs" (click)="editBulkCard(bi)">Edit</button>
              <button class="btn btn-xs" [class.btn-ghost]="!c.accepted"
                      (click)="c.accepted = !c.accepted">
                {{ c.accepted ? 'Accepted ✓' : 'Rejected' }}
              </button>
            </div>
            <div class="bulk-source">{{ c.draft.okMsg }}</div>
          </div>
        }
        <div class="actions" style="margin-top: 0.6rem;">
          <button class="btn" [disabled]="bulkSaving() || acceptedCount() === 0"
                  (click)="saveAccepted()">
            {{ bulkSaving() ? 'Saving…' : 'Save accepted (' + acceptedCount() + ')' }}
          </button>
          <button class="btn btn-ghost" (click)="bulkCards = []">Discard all</button>
        </div>
      </div>
    }

    <!-- ── Meta section ─────────────────────────────────────────────── -->
    <div class="card">
      <div class="meta-title">Meta — name, signal map, derived signals</div>
      <div class="form">
        <div class="row">
          <div class="field field--grow">
            <label>DISPLAY NAME</label>
            <input [(ngModel)]="metaName" placeholder="e.g. Central locking requirements" />
          </div>
          <div class="field">
            <label>VERSION</label>
            <input [(ngModel)]="metaVersion" placeholder="1" style="width: 70px;" />
          </div>
        </div>

        <div class="sec">
          <span class="sec-title">SIGNAL MAP (alias → catalog signal)</span>
          @for (row of signalMapRows; track $index; let i = $index) {
            <div class="map-row">
              <input [(ngModel)]="row.alias" placeholder="alias" style="width: 170px;" />
              <span style="color:#8a9ab0;">→</span>
              <input [(ngModel)]="row.signal" list="req-signal-options"
                     placeholder="catalog signal" style="width: 220px;" />
              @if (outOfScope(row.signal)) { <span class="warn">not in scope</span> }
              <button class="x-btn" (click)="signalMapRows.splice(i, 1)">✕</button>
            </div>
          }
          <button class="btn-dashed" (click)="signalMapRows.push({ alias: '', signal: '' })">
            + Mapping
          </button>
        </div>

        <div class="sec">
          <span class="sec-title">DERIVED SIGNALS (computed from bus signals; cases top-down, first match wins)</span>
          @for (d of derivedDrafts; track $index; let di = $index) {
            <div class="derived form">
              <div class="row">
                <div class="field">
                  <label>NAME</label>
                  <input class="mono" [(ngModel)]="d.name" placeholder="e.g. car_state" />
                </div>
                <div class="field field--grow">
                  <label>FROM SIGNALS (COMMA-SEPARATED)</label>
                  <input class="mono" [(ngModel)]="d.fromText" list="req-signal-options"
                         placeholder="Sig_A, Sig_B" />
                </div>
                <button class="btn btn-danger btn-xs" (click)="derivedDrafts.splice(di, 1)">
                  Remove derived
                </button>
              </div>
              @for (c of d.cases; track $index; let ci = $index) {
                <div class="case form">
                  <div class="row">
                    <div class="field">
                      <label>VALUE</label>
                      <input class="mono" [(ngModel)]="c.value" placeholder="e.g. secured" />
                    </div>
                    <button class="btn btn-danger btn-xs" (click)="d.cases.splice(ci, 1)">
                      Remove case
                    </button>
                  </div>
                  <ng-container
                    *ngTemplateOutlet="predList; context: { list: c.when, label: 'WHEN (all must hold)' }" />
                </div>
              }
              <button class="btn-dashed" (click)="d.cases.push({ value: '', when: [] })">
                + Case
              </button>
            </div>
          }
          <button class="btn-dashed" (click)="addDerived()">+ Derived signal</button>
        </div>

        @if (metaError) { <div class="msg msg--error">{{ metaError }}</div> }
        @if (metaOk) { <div class="msg msg--ok">{{ metaOk }}</div> }
        <div class="actions">
          <button class="btn" [disabled]="metaSaving" (click)="saveMeta()">
            {{ metaSaving ? 'Saving…' : 'Save meta' }}
          </button>
          <button class="btn btn-ghost" (click)="resetMeta()">Discard meta changes</button>
        </div>
      </div>
    </div>

    <!-- ── Rules ────────────────────────────────────────────────────── -->
    <div class="toolbar">
      <button class="btn" (click)="addRule()">+ Add rule</button>
      <span class="spacer"></span>
      <span style="font-size:0.68rem;color:#8a9ab0;">
        {{ rules.length }} rule(s) — each rule saves individually
      </span>
    </div>

    @for (r of rules; track $index; let ri = $index) {
      <div class="card">
        <div class="card-head" (click)="r.open = !r.open">
          <span class="rule-id">{{ r.id || '(no id)' }}</span>
          <span class="rule-title">{{ r.title }}</span>
          <span class="chip chip-kind">{{ r.kind.toUpperCase() }}</span>
          @if (r.draft) { <span class="chip chip-draft">DRAFT</span> }
          @if (r.originalId === null) {
            <span class="chip chip-new">UNSAVED</span>
          } @else {
            <span class="chip chip-saved">SAVED</span>
          }
        </div>

        @if (r.open) {
          <div class="form">
            <div class="row">
              <div class="field">
                <label>ID</label>
                <input class="mono" [(ngModel)]="r.id" placeholder="e.g. CA_1" />
              </div>
              <div class="field field--grow">
                <label>TITLE</label>
                <input [(ngModel)]="r.title" placeholder="Human-readable requirement" />
              </div>
              <div class="field">
                <label>KIND</label>
                <select [(ngModel)]="r.kind">
                  @for (k of kinds; track k) { <option [value]="k">{{ k }}</option> }
                </select>
              </div>
              <div class="field">
                <label>SEVERITY</label>
                <select [(ngModel)]="r.severity">
                  @for (s of severities; track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </div>
              <div class="field">
                <label>COMPONENT</label>
                <input [(ngModel)]="r.component" placeholder="e.g. BCM" />
              </div>
              <label class="chk">
                <input type="checkbox" [(ngModel)]="r.draft" /> draft (never judged)
              </label>
            </div>

            @if (r.kind === 'response') {
              <ng-container
                *ngTemplateOutlet="predList; context: { list: r.preconditions, label: 'PRECONDITIONS (at trigger time)' }" />
              <div class="sec">
                <span class="sec-title">TRIGGER (edge)</span>
                <div class="row">
                  <div class="field">
                    <label>SIGNAL</label>
                    <input class="mono pred-sig" [(ngModel)]="r.triggerSignal" list="req-signal-options" />
                  </div>
                  <div class="field">
                    <label>FROM (OPTIONAL)</label>
                    <input class="mono" [(ngModel)]="r.triggerFrom" />
                  </div>
                  <div class="field">
                    <label>TO</label>
                    <input class="mono" [(ngModel)]="r.triggerTo" />
                  </div>
                  @if (outOfScope(r.triggerSignal)) {
                    <span class="warn">{{ scopeWarning }}</span>
                  }
                </div>
                <ng-container *ngTemplateOutlet="labelChips; context: { sig: r.triggerSignal, set: setTriggerTo(r) }" />
              </div>
              <div class="sec">
                <span class="sec-title">EXPECT</span>
                <div class="row">
                  <div class="field">
                    <label>SIGNAL</label>
                    <input class="mono pred-sig" [(ngModel)]="r.expectSignal" list="req-signal-options" />
                  </div>
                  <div class="field">
                    <label>BECOMES</label>
                    <input class="mono" [(ngModel)]="r.expectBecomes" />
                  </div>
                  <div class="field">
                    <label>DEADLINE MS</label>
                    <input type="number" min="1" [(ngModel)]="r.deadlineMs" style="width: 100px;" />
                  </div>
                  <div class="field">
                    <label>TOLERANCE %</label>
                    <input type="number" min="0" max="100" [(ngModel)]="r.tolerancePct" style="width: 90px;" />
                  </div>
                  @if (outOfScope(r.expectSignal)) {
                    <span class="warn">{{ scopeWarning }}</span>
                  }
                </div>
                <ng-container *ngTemplateOutlet="labelChips; context: { sig: r.expectSignal, set: setExpectBecomes(r) }" />
              </div>
            }

            @if (r.kind === 'absence') {
              <ng-container
                *ngTemplateOutlet="predList; context: { list: r.whileConds, label: 'WHILE (level conditions)' }" />
              <div class="sec">
                <span class="sec-title">FORBIDDEN (edge that must never happen)</span>
                <div class="row">
                  <div class="field">
                    <label>SIGNAL</label>
                    <input class="mono pred-sig" [(ngModel)]="r.forbiddenSignal" list="req-signal-options" />
                  </div>
                  <div class="field">
                    <label>FROM (OPTIONAL)</label>
                    <input class="mono" [(ngModel)]="r.forbiddenFrom" />
                  </div>
                  <div class="field">
                    <label>TO</label>
                    <input class="mono" [(ngModel)]="r.forbiddenTo" />
                  </div>
                  @if (outOfScope(r.forbiddenSignal)) {
                    <span class="warn">{{ scopeWarning }}</span>
                  }
                </div>
                <ng-container *ngTemplateOutlet="labelChips; context: { sig: r.forbiddenSignal, set: setForbiddenTo(r) }" />
              </div>
              <div class="sec">
                <span class="sec-title">OR TRIGGER + WINDOW (forbidden within a window after a trigger)</span>
                <div class="row">
                  <div class="field">
                    <label>TRIGGER SIGNAL (OPTIONAL)</label>
                    <input class="mono pred-sig" [(ngModel)]="r.triggerSignal" list="req-signal-options" />
                  </div>
                  <div class="field">
                    <label>TO</label>
                    <input class="mono" [(ngModel)]="r.triggerTo" />
                  </div>
                  <div class="field">
                    <label>WINDOW MS</label>
                    <input type="number" min="1" [(ngModel)]="r.windowMs" style="width: 100px;" />
                  </div>
                </div>
              </div>
            }

            @if (r.kind === 'duration') {
              <ng-container
                *ngTemplateOutlet="predList; context: { list: r.whileConds, label: 'STATE (conditions defining the timed state)' }" />
              <div class="sec">
                <span class="sec-title">DURATION + EXPECT (state must end like this within the duration)</span>
                <div class="row">
                  <div class="field">
                    <label>DURATION MS</label>
                    <input type="number" min="1" [(ngModel)]="r.durationMs" style="width: 110px;" />
                  </div>
                  <div class="field">
                    <label>TOLERANCE %</label>
                    <input type="number" min="0" max="100" [(ngModel)]="r.tolerancePct" style="width: 90px;" />
                  </div>
                  <div class="field">
                    <label>EXPECT SIGNAL</label>
                    <input class="mono pred-sig" [(ngModel)]="r.expectSignal" list="req-signal-options" />
                  </div>
                  <div class="field">
                    <label>BECOMES</label>
                    <input class="mono" [(ngModel)]="r.expectBecomes" />
                  </div>
                  @if (outOfScope(r.expectSignal)) {
                    <span class="warn">{{ scopeWarning }}</span>
                  }
                </div>
                <ng-container *ngTemplateOutlet="labelChips; context: { sig: r.expectSignal, set: setExpectBecomes(r) }" />
              </div>
            }

            @if (r.kind === 'invariant') {
              <ng-container
                *ngTemplateOutlet="predList; context: { list: r.whileConds, label: 'WHEN (conditions under which the invariant applies)' }" />
              <ng-container
                *ngTemplateOutlet="predList; context: { list: r.expectAll, label: 'EXPECT ALL (predicates that must all hold)' }" />
              <div class="sec">
                <span class="sec-title">OR STATE MACHINE (allowed transitions of one signal)</span>
                <div class="row">
                  <div class="field">
                    <label>STATE SIGNAL</label>
                    <input class="mono pred-sig" [(ngModel)]="r.stateSignal" list="req-signal-options" />
                  </div>
                  @if (outOfScope(r.stateSignal)) {
                    <span class="warn">{{ scopeWarning }}</span>
                  }
                </div>
                @for (t of r.transitions; track $index; let ti = $index) {
                  <div class="pred-row">
                    <input [(ngModel)]="t.from" placeholder="from" style="width: 150px;" />
                    <span style="color:#8a9ab0;">→</span>
                    <input [(ngModel)]="t.to" placeholder="to" style="width: 150px;" />
                    <button class="x-btn" (click)="r.transitions.splice(ti, 1)">✕</button>
                  </div>
                }
                <button class="btn-dashed" (click)="r.transitions.push({ from: '', to: '' })">
                  + Transition
                </button>
              </div>
            }

            <div class="sec">
              <span class="sec-title">REPORTING (optional)</span>
              <div class="row">
                <div class="field field--grow">
                  <label>VIOLATION TITLE</label>
                  <input [(ngModel)]="r.violationTitle" placeholder="Title shown on findings" />
                </div>
              </div>
              @for (c of r.checkList; track $index; let ci = $index) {
                <div class="pred-row">
                  <input [ngModel]="c" (ngModelChange)="r.checkList[ci] = $event"
                         placeholder="check-list step" style="flex:1; min-width: 260px;" />
                  <button class="x-btn" (click)="r.checkList.splice(ci, 1)">✕</button>
                </div>
              }
              <button class="btn-dashed" (click)="r.checkList.push('')">+ Check-list step</button>
            </div>

            @if (hasOutOfScopeSignals(r)) {
              <div class="notice">
                Some referenced signals are not in the assigned cars' catalogs —
                the rule will be NOT_EVALUABLE at runtime. Consider saving it as
                a draft until the signals are available.
              </div>
            }
            @if (r.error) { <div class="msg msg--error">{{ r.error }}</div> }
            @if (r.okMsg) { <div class="msg msg--ok">{{ r.okMsg }}</div> }

            <div class="actions">
              <button class="btn" [disabled]="r.saving" (click)="saveRule(r)">
                {{ r.saving ? 'Saving…' : (r.originalId === null ? 'Save new rule' : 'Save rule') }}
              </button>
              <button class="btn btn-ghost" (click)="duplicateRule(r)">Duplicate</button>
              <button class="btn btn-danger" [disabled]="r.saving" (click)="removeRule(r, ri)">
                {{ r.originalId === null ? 'Discard' : 'Delete rule' }}
              </button>
            </div>
          </div>
        }
      </div>
    }

    <!-- ── Shared predicate-list editor ─────────────────────────────── -->
    <ng-template #predList let-list="list" let-label="label">
      <div class="sec">
        <span class="sec-title">{{ label }}</span>
        @for (p of list; track $index; let pi = $index) {
          <div>
            <div class="pred-row">
              @if (p.useRaw) {
                <input class="pred-raw" [(ngModel)]="p.raw"
                       placeholder="e.g. KEY_Butt in [1000, 2000]" />
              } @else {
                <input class="pred-sig" [(ngModel)]="p.signal" list="req-signal-options"
                       placeholder="signal" />
                <select class="pred-op" [(ngModel)]="p.op">
                  @for (op of ops; track op) { <option [value]="op">{{ op }}</option> }
                </select>
                <input class="pred-val" [(ngModel)]="p.value" placeholder="value" />
              }
              <button class="btn btn-ghost btn-xs" (click)="p.useRaw = !p.useRaw; syncRaw(p)">
                {{ p.useRaw ? 'builder' : 'raw' }}
              </button>
              <button class="x-btn" (click)="list.splice(pi, 1)">✕</button>
              @if (!p.useRaw && outOfScope(p.signal)) {
                <span class="warn">{{ scopeWarning }}</span>
              }
            </div>
            @if (!p.useRaw && labelsFor(p.signal).length > 0) {
              <div class="labels" style="margin-top: 0.25rem;">
                @for (lab of labelsFor(p.signal); track lab) {
                  <span class="label-chip" (click)="p.value = lab">{{ lab }}</span>
                }
              </div>
            }
          </div>
        }
        <button class="btn-dashed" (click)="list.push(newPred())">+ Condition</button>
      </div>
    </ng-template>

    <!-- Enum-label chips for a single value input (edge "to", expect "becomes") -->
    <ng-template #labelChips let-sig="sig" let-set="set">
      @if (labelsFor(sig).length > 0) {
        <div class="labels">
          @for (lab of labelsFor(sig); track lab) {
            <span class="label-chip" (click)="set(lab)">{{ lab }}</span>
          }
        </div>
      }
    </ng-template>
  `,
})
export class RequirementEditTabComponent implements OnInit {
  private requirementService = inject(RequirementService);

  @Input({ required: true }) filename = '';
  @Input() detail: RequirementFileDetail | null = null;
  /** Emitted after any successful mutation so the parent refreshes the detail. */
  @Output() saved = new EventEmitter<void>();

  readonly context = signal<SignalContext | null>(null);

  readonly ops = OPS;
  readonly kinds = KINDS;
  readonly severities = SEVERITIES;
  readonly scopeWarning = 'not in the assigned cars’ catalogs';

  rules: RuleDraft[] = [];
  nlText = '';
  bulkMode = false;
  bulkCards: BulkCard[] = [];
  readonly bulkSaving = signal(false);
  readonly nlBusy = signal(false);
  readonly nlEngine = signal('');
  readonly nlWarnings = signal<string[]>([]);
  readonly nlError = signal('');
  metaName = '';
  metaVersion = '';
  signalMapRows: SignalMapRow[] = [];
  derivedDrafts: DerivedDraft[] = [];
  metaSaving = false;
  metaError = '';
  metaOk = '';

  /** Catalog signal names + derived names + signal_map aliases for autocomplete. */
  readonly signalNames = computed(() => {
    const names = new Set<string>();
    for (const s of this.context()?.signals ?? []) {
      names.add(s.name);
    }
    for (const d of this.detail?.derivedSignals ?? []) {
      names.add(d.name);
    }
    for (const alias of Object.keys(this.detail?.signalMap ?? {})) {
      names.add(alias);
    }
    return [...names].sort();
  });

  ngOnInit(): void {
    this.resetMeta();
    this.rules = (this.detail?.rules ?? []).map((r) => this.toDraft(r));
    this.requirementService.getSignalContext(this.filename).subscribe({
      next: (ctx) => this.context.set(ctx),
      error: () => this.context.set(null),
    });
  }

  // ── Scope helpers ─────────────────────────────────────────────────────────

  /** True when a non-empty signal reference is not resolvable in scope. */
  outOfScope(name: string): boolean {
    const trimmed = (name ?? '').trim();
    if (!trimmed || !this.context()) return false;
    return !this.signalNames().includes(trimmed)
      && !this.localNames().has(trimmed);
  }

  /** Enum labels of a catalog signal (merged across catalogs). */
  labelsFor(name: string): string[] {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return [];
    const labels = new Set<string>();
    for (const s of this.context()?.signals ?? []) {
      if (s.name === trimmed) {
        s.labels.forEach((l) => labels.add(l));
      }
    }
    return [...labels];
  }

  /** Names defined by the unsaved meta draft (derived + aliases). */
  private localNames(): Set<string> {
    const names = new Set<string>();
    for (const d of this.derivedDrafts) {
      if (d.name.trim()) names.add(d.name.trim());
    }
    for (const row of this.signalMapRows) {
      if (row.alias.trim()) names.add(row.alias.trim());
    }
    return names;
  }

  hasOutOfScopeSignals(r: RuleDraft): boolean {
    const referenced = [
      r.triggerSignal, r.forbiddenSignal, r.expectSignal, r.stateSignal,
      ...r.preconditions.filter((p) => !p.useRaw).map((p) => p.signal),
      ...r.whileConds.filter((p) => !p.useRaw).map((p) => p.signal),
      ...r.expectAll.filter((p) => !p.useRaw).map((p) => p.signal),
    ];
    return referenced.some((s) => this.outOfScope(s));
  }

  // ── Rule editing ──────────────────────────────────────────────────────────

  newPred(): PredDraft {
    return { useRaw: false, signal: '', op: '==', value: '', raw: '' };
  }

  /** When toggling to raw, seed the raw text from the builder fields. */
  syncRaw(p: PredDraft): void {
    if (p.useRaw && !p.raw.trim() && p.signal.trim()) {
      p.raw = this.predToString(p);
    }
  }

  addRule(): void {
    this.rules.unshift({
      originalId: null,
      id: '', title: '', component: '', severity: 'medium', kind: 'response',
      draft: false,
      preconditions: [], whileConds: [], expectAll: [],
      triggerSignal: '', triggerFrom: '', triggerTo: '',
      forbiddenSignal: '', forbiddenFrom: '', forbiddenTo: '',
      expectSignal: '', expectBecomes: '',
      deadlineMs: null, durationMs: null, windowMs: null, tolerancePct: null,
      stateSignal: '', transitions: [],
      violationTitle: '', checkList: [],
      open: true, saving: false, error: '', okMsg: '',
    });
  }

  duplicateRule(r: RuleDraft): void {
    const copy: RuleDraft = structuredClone(r);
    copy.originalId = null;
    copy.id = r.id ? r.id + '_copy' : '';
    copy.open = true;
    copy.saving = false;
    copy.error = '';
    copy.okMsg = '';
    this.rules.splice(this.rules.indexOf(r) + 1, 0, copy);
  }

  saveRule(r: RuleDraft): void {
    r.error = '';
    r.okMsg = '';
    // Unresolved / out-of-scope signals force draft (plan C.2) — the rule
    // would be NOT_EVALUABLE at runtime anyway.
    if (this.hasOutOfScopeSignals(r)) {
      r.draft = true;
    }
    r.saving = true;
    const payload = this.toPayload(r);
    const call = r.originalId === null
      ? this.requirementService.addRule(this.filename, payload)
      : this.requirementService.updateRule(this.filename, r.originalId, payload);
    call.subscribe({
      next: () => {
        r.saving = false;
        r.originalId = payload.id;
        r.okMsg = 'Saved.';
        this.saved.emit();
      },
      error: (err) => {
        r.saving = false;
        r.error = this.messageOf(err, 'Save failed — rule rejected.');
      },
    });
  }

  removeRule(r: RuleDraft, index: number): void {
    if (r.originalId === null) {
      this.rules.splice(index, 1);
      return;
    }
    r.saving = true;
    this.requirementService.deleteRule(this.filename, r.originalId).subscribe({
      next: () => {
        this.rules.splice(index, 1);
        this.saved.emit();
      },
      error: (err) => {
        r.saving = false;
        r.error = this.messageOf(err, 'Delete failed.');
      },
    });
  }

  // Template helpers returning setters so label chips can fill value inputs.
  setTriggerTo(r: RuleDraft): (v: string) => void {
    return (v) => { r.triggerTo = v; };
  }
  setForbiddenTo(r: RuleDraft): (v: string) => void {
    return (v) => { r.forbiddenTo = v; };
  }
  setExpectBecomes(r: RuleDraft): (v: string) => void {
    return (v) => { r.expectBecomes = v; };
  }

  // ── Natural language conversion (Phase C) ─────────────────────────────────

  /** Convert the sentence; each returned draft opens as an UNSAVED rule card. */
  convertNl(): void {
    const text = this.nlText.trim();
    if (!text || this.nlBusy()) return;
    this.nlBusy.set(true);
    this.nlError.set('');
    this.nlEngine.set('');
    this.nlWarnings.set([]);
    const mode = this.bulkMode ? 'bulk' : 'single';
    this.requirementService.nlConvert(text, this.filename, undefined, mode).subscribe({
      next: (res) => {
        this.nlBusy.set(false);
        this.nlEngine.set(res.engine);
        this.nlWarnings.set(res.warnings);
        if (this.bulkMode) {
          // Bulk: drafts go to the review list — accept / edit / reject each.
          this.bulkCards = res.drafts.map((d) => ({
            draft: this.fromNlDraft(d),
            unresolvedCount: d.signals.filter((s) => s.status === 'unresolved').length,
            accepted: true,
          }));
        } else {
          for (const draft of [...res.drafts].reverse()) {
            this.rules.unshift(this.fromNlDraft(draft));
          }
        }
        if (res.drafts.length > 0) {
          this.nlText = '';
        }
      },
      error: (err) => {
        this.nlBusy.set(false);
        this.nlError.set(this.messageOf(err, 'Conversion failed.'));
      },
    });
  }

  acceptedCount(): number {
    return this.bulkCards.filter((c) => c.accepted).length;
  }

  /** "Inline edit" a bulk draft: it becomes an UNSAVED card in the rule list. */
  editBulkCard(index: number): void {
    const card = this.bulkCards[index];
    if (!card) return;
    card.draft.open = true;
    this.rules.unshift(card.draft);
    this.bulkCards.splice(index, 1);
  }

  /** Append every accepted draft through the batch endpoint — one file write. */
  saveAccepted(): void {
    const accepted = this.bulkCards.filter((c) => c.accepted);
    if (accepted.length === 0 || this.bulkSaving()) return;
    this.nlError.set('');
    this.bulkSaving.set(true);
    const payloads = accepted.map((c) => {
      if (this.hasOutOfScopeSignals(c.draft)) {
        c.draft.draft = true;
      }
      return this.toPayload(c.draft);
    });
    this.requirementService.addRulesBatch(this.filename, payloads).subscribe({
      next: () => {
        this.bulkSaving.set(false);
        this.bulkCards = this.bulkCards.filter((c) => !c.accepted);
        this.saved.emit();
      },
      error: (err) => {
        this.bulkSaving.set(false);
        this.nlError.set(this.messageOf(err, 'Batch save failed — no rule was written.'));
      },
    });
  }

  /** NL draft -> editable UNSAVED rule card, pre-filled in the same form. */
  private fromNlDraft(draft: NlRuleDraft): RuleDraft {
    const p = draft.rule;
    return {
      originalId: null,
      id: p.id ?? '',
      title: p.title ?? '',
      component: p.component ?? '',
      severity: (p.severity || 'medium').toLowerCase(),
      kind: (p.kind || 'response').toLowerCase(),
      draft: p.draft,
      preconditions: (p.preconditions ?? []).map((s) => this.parseRawPredicate(s)),
      whileConds: (p.whileConds ?? []).map((s) => this.parseRawPredicate(s)),
      expectAll: (p.expectAll ?? []).map((s) => this.parseRawPredicate(s)),
      triggerSignal: p.trigger?.signal ?? '',
      triggerFrom: p.trigger?.from ?? '',
      triggerTo: p.trigger?.to ?? '',
      forbiddenSignal: p.forbidden?.signal ?? '',
      forbiddenFrom: p.forbidden?.from ?? '',
      forbiddenTo: p.forbidden?.to ?? '',
      expectSignal: p.expect?.signal ?? '',
      expectBecomes: p.expect?.becomes ?? '',
      deadlineMs: p.deadlineMs,
      durationMs: p.durationMs,
      windowMs: p.windowMs,
      tolerancePct: p.tolerancePct,
      stateSignal: p.stateSignal ?? '',
      transitions: (p.allowedTransitions ?? [])
        .filter((t) => t.length === 2)
        .map((t) => ({ from: t[0], to: t[1] })),
      violationTitle: p.violationTitle ?? '',
      checkList: [...(p.checkList ?? [])],
      open: true, saving: false, error: '',
      okMsg: `Converted from: "${draft.source}" (confidence ${Math.round(draft.confidence * 100)}%)`,
    };
  }

  /** Raw predicate string -> builder row; unknown shapes fall back to raw mode. */
  private parseRawPredicate(raw: string): PredDraft {
    const m = /^(\S+)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(raw.trim());
    if (!m || m[3].trim().startsWith('[')) {
      return { useRaw: true, signal: '', op: '==', value: '', raw: raw.trim() };
    }
    return {
      useRaw: false,
      signal: m[1],
      op: m[2],
      value: this.unquote(m[3].trim()),
      raw: raw.trim(),
    };
  }

  private unquote(v: string): string {
    if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'"))
        || (v.startsWith('"') && v.endsWith('"')))) {
      return v.substring(1, v.length - 1);
    }
    return v;
  }

  // ── Meta editing ──────────────────────────────────────────────────────────

  addDerived(): void {
    this.derivedDrafts.push({
      name: '', fromText: '',
      cases: [{ value: '', when: [] }],
    });
  }

  resetMeta(): void {
    this.metaName = this.detail?.name ?? '';
    this.metaVersion = this.detail?.version ?? '';
    this.signalMapRows = Object.entries(this.detail?.signalMap ?? {})
      .map(([alias, sig]) => ({ alias, signal: sig }));
    this.derivedDrafts = (this.detail?.derivedSignals ?? []).map((d) => ({
      name: d.name,
      fromText: d.from.join(', '),
      cases: d.cases.map((c) => ({
        value: c.value,
        when: c.conditions.map((p) => this.predFromModel(p)),
      })),
    }));
    this.metaError = '';
    this.metaOk = '';
  }

  saveMeta(): void {
    this.metaError = '';
    this.metaOk = '';
    this.metaSaving = true;
    const signalMap: Record<string, string> = {};
    for (const row of this.signalMapRows) {
      if (row.alias.trim() && row.signal.trim()) {
        signalMap[row.alias.trim()] = row.signal.trim();
      }
    }
    const payload: MetaUpdatePayload = {
      name: this.metaName.trim() || null,
      version: this.metaVersion.trim() || null,
      signalMap,
      derivedSignals: this.derivedDrafts
        .filter((d) => d.name.trim())
        .map((d) => ({
          name: d.name.trim(),
          from: d.fromText.split(',').map((s) => s.trim()).filter(Boolean),
          cases: d.cases
            .filter((c) => c.value.trim())
            .map((c) => ({
              value: c.value.trim(),
              when: c.when.map((p) => this.predToString(p)).filter(Boolean),
            })),
        })),
    };
    this.requirementService.updateMeta(this.filename, payload).subscribe({
      next: () => {
        this.metaSaving = false;
        this.metaOk = 'Meta saved.';
        this.saved.emit();
      },
      error: (err) => {
        this.metaSaving = false;
        this.metaError = this.messageOf(err, 'Save failed — meta rejected.');
      },
    });
  }

  // ── Model <-> draft mapping ───────────────────────────────────────────────

  private toDraft(r: RequirementRule): RuleDraft {
    return {
      originalId: r.id,
      id: r.id,
      title: r.title ?? '',
      component: r.component ?? '',
      severity: r.severity.toLowerCase(),
      kind: r.kind.toLowerCase(),
      draft: r.draft,
      preconditions: r.preconditions.map((p) => this.predFromModel(p)),
      whileConds: r.whileConds.map((p) => this.predFromModel(p)),
      expectAll: r.expectAll.map((p) => this.predFromModel(p)),
      triggerSignal: r.trigger?.signal ?? '',
      triggerFrom: r.trigger?.from ?? '',
      triggerTo: r.trigger?.to ?? '',
      forbiddenSignal: r.forbidden?.signal ?? '',
      forbiddenFrom: r.forbidden?.from ?? '',
      forbiddenTo: r.forbidden?.to ?? '',
      expectSignal: r.expect?.signal ?? '',
      expectBecomes: r.expect?.becomes ?? '',
      deadlineMs: r.deadlineMs,
      durationMs: r.durationMs,
      windowMs: r.windowMs,
      tolerancePct: r.tolerancePct,
      stateSignal: r.stateSignal ?? '',
      transitions: r.allowedTransitions.map((t) => ({ from: t.from, to: t.to })),
      violationTitle: r.violationTitle ?? '',
      checkList: [...r.checkList],
      open: false, saving: false, error: '', okMsg: '',
    };
  }

  private predFromModel(p: RequirementPredicate): PredDraft {
    const opMap: Record<string, string> = {
      EQ: '==', NE: '!=', LT: '<', LE: '<=', GT: '>', GE: '>=',
    };
    if (p.op === 'IN' || !opMap[p.op]) {
      return { useRaw: true, signal: p.signal, op: '==', value: '', raw: p.raw };
    }
    return {
      useRaw: false,
      signal: p.signal,
      op: opMap[p.op],
      value: p.values[0] ?? '',
      raw: p.raw,
    };
  }

  /** Compose the raw predicate string the backend parser understands. */
  predToString(p: PredDraft): string {
    if (p.useRaw) {
      return p.raw.trim();
    }
    if (!p.signal.trim()) {
      return '';
    }
    return `${p.signal.trim()} ${p.op} ${this.quote(p.value.trim())}`;
  }

  /** Numbers stay bare; anything else is single-quoted for the parser. */
  private quote(v: string): string {
    if (v !== '' && !isNaN(Number(v))) {
      return v;
    }
    return `'${v.replace(/'/g, '')}'`;
  }

  private toPayload(r: RuleDraft): RuleEditPayload {
    const preds = (list: PredDraft[]) =>
      list.map((p) => this.predToString(p)).filter(Boolean);
    return {
      id: r.id.trim(),
      title: r.title.trim() || null,
      component: r.component.trim() || null,
      severity: r.severity,
      kind: r.kind,
      draft: r.draft,
      preconditions: r.kind === 'response' ? preds(r.preconditions) : [],
      whileConds: r.kind === 'response' ? [] : preds(r.whileConds),
      trigger: r.triggerSignal.trim() && (r.kind === 'response' || r.kind === 'absence')
        ? {
            signal: r.triggerSignal.trim(),
            from: r.triggerFrom.trim() || null,
            to: r.triggerTo.trim() || null,
          }
        : null,
      forbidden: r.forbiddenSignal.trim() && r.kind === 'absence'
        ? {
            signal: r.forbiddenSignal.trim(),
            from: r.forbiddenFrom.trim() || null,
            to: r.forbiddenTo.trim() || null,
          }
        : null,
      expect: r.expectSignal.trim() && (r.kind === 'response' || r.kind === 'duration')
        ? { signal: r.expectSignal.trim(), becomes: r.expectBecomes.trim() }
        : null,
      expectAll: r.kind === 'invariant' ? preds(r.expectAll) : [],
      deadlineMs: r.kind === 'response' ? r.deadlineMs : null,
      durationMs: r.kind === 'duration' ? r.durationMs : null,
      windowMs: r.kind === 'absence' ? r.windowMs : null,
      tolerancePct: r.kind === 'response' || r.kind === 'duration' ? r.tolerancePct : null,
      stateSignal: r.kind === 'invariant' ? r.stateSignal.trim() || null : null,
      allowedTransitions: r.kind === 'invariant'
        ? r.transitions
            .filter((t) => t.from.trim() && t.to.trim())
            .map((t) => [t.from.trim(), t.to.trim()])
        : [],
      violationTitle: r.violationTitle.trim() || null,
      checkList: r.checkList.map((c) => c.trim()).filter(Boolean),
    };
  }

  private messageOf(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && typeof err.error?.error === 'string') {
      return err.error.error;
    }
    return fallback;
  }
}
