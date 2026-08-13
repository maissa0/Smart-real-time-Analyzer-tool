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
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { API_BASE_URL } from '../../core/config/api.config';

interface SignalValue { value: string; label: string; }
interface SignalDef   { name: string; bit: string; byteNum: number; values: SignalValue[]; }
interface MessageDef  { id: string; name: string; cycleMs: number | null; signals: SignalDef[]; }
interface CatalogDetail { filename: string; busName: string; messages: MessageDef[]; }

type PageMode = 'view' | 'edit' | 'source';
type SrcView  = 'preview' | 'edit';
type SrcTheme = 'editor' | 'terminal' | 'minimal';
type TokenRole = 'punct' | 'tag' | 'attr' | 'string' | 'text' | 'decl';
interface SourceToken { text: string; role: TokenRole; }
interface SourceLine  { num: number; tokens: SourceToken[]; }

/** Syntax-highlight palettes for the source tab (Editor / Terminal / Minimal). */
const SRC_THEMES: Record<SrcTheme, Record<string, string>> = {
  editor:   { bg: '#0d1117', border: '#21262d', punct: '#d4d4d4', tag: '#569cd6', attr: '#9cdcfe', string: '#ce9178', text: '#d4d4d4', linenum: '#484f58', decl: '#6a9955' },
  terminal: { bg: '#000000', border: 'rgba(57,255,20,0.25)', punct: '#39ff14', tag: '#39ff14', attr: '#00e5ff', string: '#ffe14d', text: '#e8ffe8', linenum: '#1f7a12', decl: '#1f7a12' },
  minimal:  { bg: '#0d1117', border: '#21262d', punct: '#8a9ab0', tag: '#e6edf3', attr: '#b0ff44', string: '#e6edf3', text: '#e6edf3', linenum: '#484f58', decl: '#484f58' },
};

/**
 * Full decode view of one catalogue file: every message with its CAN ID and
 * cycle time, every signal with its byte position, bit layout, derived
 * mask/shift, and the enumerated values with their meanings.
 *
 * Edit mode patches the catalog through the structured endpoint
 * (PUT /api/catalogs/{filename}); source mode round-trips the raw XML
 * (GET/PUT /api/catalogs/{filename}/source). Both validate server-side.
 *
 * Works both as a routed page (/admin/catalogs/:filename) and embedded inside
 * the vehicle detail page's Catalogs tab ([fileOverride] + [embedded]).
 */
@Component({
  selector: 'app-catalog-detail-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host { display: block; }
    .cd-wrap {
      min-height: 100%; color: var(--kpit-body, #e6edf3);
      font-family: var(--kpit-font-sans, 'IBM Plex Sans', system-ui, sans-serif);
      padding: 24px 28px 80px; max-width: 1360px; margin: 0 auto;
      font-size: 13px;
    }
    .cd-wrap--embedded { padding: 0; max-width: none; }

    .cd-back {
      color: #8a9ab0; text-decoration: none; font-size: 13px;
      background: none; border: none; padding: 0; cursor: pointer; font-family: inherit;
    }
    .cd-back:hover { color: #b0ff44; }

    .cd-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-top: 14px; flex-wrap: wrap; gap: 14px;
    }
    .cd-wrap--embedded .cd-header { margin-top: 0; }
    .cd-title {
      margin: 0; font-size: 15px; font-weight: 700; color: #ffffff;
      font-family: var(--kpit-font-mono, monospace); word-break: break-all;
    }
    .cd-sub {
      color: #8a9ab0; font-size: 12px; margin-top: 6px;
      font-family: var(--kpit-font-mono, monospace);
    }
    .cd-legend {
      color: #8a9ab0; font-size: 12.5px; margin-top: 14px; max-width: 900px; line-height: 1.65;
    }
    .cd-legend .mono { font-family: var(--kpit-font-mono, monospace); color: #e6edf3; }

    .seg {
      display: flex; background: #0d1117; border: 1px solid #21262d;
      border-radius: 8px; padding: 3px; gap: 2px;
    }
    .seg button {
      border: none; cursor: pointer; padding: 7px 16px; border-radius: 6px;
      font-size: 12.5px; font-weight: 600; background: transparent; color: #8a9ab0;
      font-family: inherit;
    }
    .seg button:hover { color: #e6edf3; }
    .seg button.active { background: rgba(176,255,68,0.12); color: #b0ff44; }
    .seg--sm button { padding: 6px 12px; font-size: 12px; }

    .btn {
      font-size: 12.5px; padding: 9px 16px; border-radius: 7px; cursor: pointer;
      background: #161b22; color: #e6edf3; border: 1px solid #21262d;
      font-weight: 600; font-family: inherit;
    }
    .btn:hover:not(:disabled) { border-color: rgba(176,255,68,0.3); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn--primary { background: #b0ff44; color: #07090b; border: 1px solid #b0ff44; font-weight: 700; }
    .btn--primary:hover:not(:disabled) { opacity: 0.88; }
    .btn--accent { color: #b0ff44; border-color: rgba(176,255,68,0.3); background: rgba(176,255,68,0.08); }
    .btn--danger { color: #ff4444; border-color: rgba(255,68,68,0.3); background: transparent; }
    .btn--dashed {
      background: none; color: #b0ff44; border: 1px dashed rgba(176,255,68,0.3);
      font-size: 12px; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-family: inherit;
    }
    .btn--sm { font-size: 12px; padding: 7px 12px; border-radius: 6px; white-space: nowrap; }

    .cd-banner {
      border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-top: 14px;
      white-space: pre-wrap;
    }
    .cd-banner--error { border: 1px solid rgba(255,68,68,0.3); color: #ff4444; background: rgba(255,68,68,0.07); }
    .cd-banner--ok { border: 1px solid rgba(176,255,68,0.3); color: #b0ff44; background: rgba(176,255,68,0.07); }

    .card {
      background: #0d1117; border: 1px solid #21262d;
      border-radius: 8px; margin-top: 14px; overflow: hidden;
    }
    .msg-head {
      display: flex; align-items: center; gap: 10px; padding: 14px 16px; cursor: pointer;
      width: 100%; background: transparent; border: none; text-align: left;
      color: inherit; font-family: inherit; font-size: inherit; flex-wrap: wrap;
    }
    .msg-head:hover { background: rgba(255,255,255,0.02); }
    .msg-chevron {
      font-size: 10px; color: #484f58; display: inline-block; transition: transform 0.15s;
    }
    .msg-chevron--open { transform: rotate(90deg); }
    .msg-name {
      font-weight: 600; font-size: 13.5px; color: #ffffff;
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pill {
      font-size: 11px; padding: 2px 8px; border-radius: 5px;
      background: #161b22; color: #8a9ab0; border: 1px solid #21262d; white-space: nowrap;
    }
    .pill--id {
      background: rgba(176,255,68,0.1); color: #b0ff44; border-color: rgba(176,255,68,0.3);
      font-family: var(--kpit-font-mono, monospace);
    }
    .pill--cycle { background: rgba(240,165,0,0.1); color: #f0a500; border-color: rgba(240,165,0,0.28); }
    .spacer { flex: 1; }
    .msg-count { color: #484f58; font-size: 11.5px; white-space: nowrap; }
    .msg-body { border-top: 1px solid #21262d; }

    .sig { padding: 14px 16px; border-bottom: 1px solid #161b22; }
    .sig:last-child { border-bottom: none; }
    .sig-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .sig-name { font-weight: 600; font-size: 13px; color: #e6edf3; }
    .chip {
      font-size: 11px; color: #8a9ab0; background: #161b22; padding: 2px 8px; border-radius: 5px;
      font-family: var(--kpit-font-mono, monospace);
    }
    .bits { display: flex; gap: 3px; }
    .bit {
      width: 21px; height: 21px; border-radius: 4px; display: flex; align-items: center;
      justify-content: center; font-size: 11px; font-weight: 700;
      font-family: var(--kpit-font-mono, monospace);
      background: #161b22; color: #484f58; border: none; padding: 0;
    }
    .bit--on { background: #b0ff44; color: #07090b; }
    .bit--click { cursor: pointer; width: 24px; height: 24px; }
    .sig-meta { font-size: 11.5px; color: #8a9ab0; font-family: var(--kpit-font-mono, monospace); }
    .empty-vals { font-size: 12px; color: #484f58; font-style: italic; }

    .vals { margin-top: 12px; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; }
    .vals-head {
      display: grid; grid-template-columns: minmax(64px, 90px) minmax(84px, 110px) minmax(0, 1fr);
      background: #161b22; padding: 8px 14px; font-size: 10px; color: #484f58;
      letter-spacing: 0.14em; font-weight: 700; text-transform: uppercase;
    }
    .vals-row {
      display: grid; grid-template-columns: minmax(64px, 90px) minmax(84px, 110px) minmax(0, 1fr);
      padding: 9px 14px;
    }
    .vals-row:nth-child(odd) { background: rgba(255,255,255,0.02); }
    .val-v { color: #b0ff44; font-family: var(--kpit-font-mono, monospace); font-size: 12.5px; }
    .val-b { font-family: var(--kpit-font-mono, monospace); color: #8a9ab0; font-size: 12.5px; }
    .val-m { font-size: 13px; color: #e6edf3; min-width: 0; overflow-wrap: anywhere; }

    .toolbar {
      display: flex; gap: 10px; margin-top: 16px; align-items: center; flex-wrap: wrap;
      position: sticky; top: 0; z-index: 10; background: #07090b; padding: 10px 0;
    }
    /* Embedded in the vehicle page: clear the sticky tab bar above. */
    .cd-wrap--embedded .toolbar { top: 45px; }
    .field label {
      display: block; font-size: 10px; color: #8a9ab0; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
    }
    .field input {
      display: block; margin-top: 6px; width: 100%;
      background: #161b22; border: 1px solid #21262d; border-radius: 6px;
      padding: 9px 11px; color: #e6edf3; font-size: 13px; font-family: inherit;
    }
    .field input:focus { outline: 2px solid rgba(176,255,68,0.3); outline-offset: 0; }
    .field input.mono { font-family: var(--kpit-font-mono, monospace); }
    .bus-field { margin-top: 16px; max-width: 280px; }
    .edit-card { padding: 18px; overflow: visible; }
    .msg-grid {
      display: grid; gap: 12px; align-items: end;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto auto;
    }
    .sig-edit { margin-top: 16px; padding-top: 16px; border-top: 1px solid #161b22; }
    .sig-grid {
      display: grid; gap: 12px; align-items: end;
      grid-template-columns: minmax(0, 1.2fr) minmax(72px, 90px) minmax(0, 1.4fr) auto auto;
    }
    .sig-grid .bits { padding-bottom: 9px; }
    @media (max-width: 1100px) {
      .msg-grid, .sig-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    }
    .val-edit-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .val-edit-row {
      display: grid; grid-template-columns: minmax(0, 110px) minmax(0, 1fr) 40px;
      gap: 10px; align-items: center;
    }
    .val-x {
      margin-top: 14px; background: #161b22; color: #8a9ab0;
      border: 1px solid #21262d; border-radius: 6px; height: 32px; cursor: pointer;
    }
    .val-edit-row .field input { margin-top: 4px; padding: 7px 9px; border-radius: 6px; }
    .val-edit-row .field label { font-size: 10px; }

    .code {
      margin-top: 14px; border: 1px solid; border-radius: 8px; padding: 16px 0; overflow-x: auto;
    }
    .code-line {
      display: flex; padding: 1px 20px;
      font-family: var(--kpit-font-mono, monospace);
      font-size: 12.5px; line-height: 1.7; white-space: pre;
    }
    .lineno { width: 32px; text-align: right; margin-right: 18px; user-select: none; flex-shrink: 0; }
    .src-textarea {
      margin-top: 14px; width: 100%; min-height: 60vh; resize: vertical;
      border: 1px solid #21262d; border-radius: 8px;
      color: #e6edf3; font-family: var(--kpit-font-mono, monospace);
      font-size: 12.5px; padding: 16px 18px; line-height: 1.7; white-space: pre; tab-size: 2;
      background: #0d1117;
    }
    .src-textarea:focus { outline: 2px solid rgba(176,255,68,0.3); outline-offset: 0; }
    .cd-loading, .cd-error { padding: 2rem; text-align: center; color: #8a9ab0; }
    .cd-error { color: #ff4444; }

    button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible {
      outline: 2px solid rgba(176,255,68,0.4); outline-offset: 1px;
    }
  `],
  template: `
    <div class="cd-wrap" [class.cd-wrap--embedded]="embedded">
      @if (!embedded) {
        <button class="cd-back" type="button" (click)="goBack()">← {{ returnUrl ? 'Back' : 'Back to catalogs' }}</button>
      }

      @if (loading()) {
        <p class="cd-loading">Decoding catalog…</p>
      } @else if (error()) {
        <p class="cd-error">{{ error() }}</p>
      } @else if (detail(); as d) {
        @if (embedded && mode() !== 'view') {
          <button class="cd-back" type="button" style="margin-bottom:10px;"
                  (click)="enterView()">← Back to the list</button>
        }
        <div class="cd-header">
          <div>
            <h1 class="cd-title">{{ d.filename }}</h1>
            <div class="cd-sub">
              {{ d.busName || 'Unknown bus' }} ·
              {{ d.messages.length }} messages · {{ signalCount() }} signals
            </div>
          </div>
          <div class="seg" role="group" aria-label="Catalog mode">
            <button [class.active]="mode() === 'view'" (click)="enterView()">View</button>
            <button [class.active]="mode() === 'edit'" (click)="enterEdit()">Edit</button>
            <button [class.active]="mode() === 'source'" (click)="enterSource()">Source</button>
          </div>
        </div>

        @if (saveError()) {
          <div class="cd-banner cd-banner--error">{{ saveError() }}</div>
        }
        @if (saveSuccess()) {
          <div class="cd-banner cd-banner--ok">{{ saveSuccess() }}</div>
        }

        <p class="cd-legend">
          Each signal occupies the highlighted bits of its byte (bit 7 → 0).
          A frame payload is 8 bytes; the mask/shift show how the raw value is
          extracted: <span class="mono">value = (byte &amp; mask) >> shift</span>.
        </p>

        <!-- ── View tab ─────────────────────────────────────────────── -->
        @if (mode() === 'view') {
          @for (msg of d.messages; track msg.id + msg.name; let mi = $index) {
            <div class="card">
              <button class="msg-head" type="button" (click)="toggleMsg(mi)"
                      [attr.aria-expanded]="isMsgOpen(mi)">
                <span class="msg-chevron" [class.msg-chevron--open]="isMsgOpen(mi)">▶</span>
                <span class="msg-name">{{ msg.name || '(unnamed)' }}</span>
                <span class="pill pill--id">ID {{ msg.id }}</span>
                @if (msg.cycleMs != null) {
                  <span class="pill pill--cycle">cyclic · every {{ msg.cycleMs }} ms</span>
                } @else {
                  <span class="pill">event</span>
                }
                <span class="spacer"></span>
                <span class="msg-count">{{ msg.signals.length }} signal(s)</span>
              </button>

              @if (isMsgOpen(mi)) {
                <div class="msg-body">
                  @for (sig of msg.signals; track $index; let si = $index) {
                    <div class="sig">
                      <div class="sig-row">
                        <span class="sig-name">{{ sig.name || '(unnamed signal)' }}</span>
                        <span class="chip">byte {{ sig.byteNum }}</span>
                        <span class="bits" [title]="'bit pattern ' + sig.bit">
                          @for (cell of bitCells(sig.bit); track $index) {
                            <span class="bit" [class.bit--on]="cell === '1'">{{ cell }}</span>
                          }
                        </span>
                        <span class="sig-meta">
                          mask {{ maskHex(sig.bit) }} · shift {{ shiftOf(sig.bit) }}
                          · {{ widthOf(sig.bit) }} bit(s) · range 0–{{ maxOf(sig.bit) }}
                        </span>
                        <span class="spacer"></span>
                        @if (hasRealValues(sig)) {
                          <button class="btn btn--sm" (click)="toggleValues(mi, si)">
                            {{ isValuesOpen(mi, si) ? 'Hide' : 'Show' }} values ({{ sig.values.length }})
                          </button>
                        } @else {
                          <span class="empty-vals">Continuous / numeric — no enumerated values.</span>
                        }
                      </div>

                      @if (hasRealValues(sig) && isValuesOpen(mi, si)) {
                        <div class="vals">
                          <div class="vals-head">
                            <div>VALUE</div><div>BINARY</div><div>MEANING</div>
                          </div>
                          @for (v of sig.values; track $index) {
                            <div class="vals-row">
                              <div class="val-v">{{ v.value }}</div>
                              <div class="val-b">{{ toBinary(v.value, sig.bit) }}</div>
                              <div class="val-m">{{ v.label || '—' }}</div>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        }

        <!-- ── Edit tab ─────────────────────────────────────────────── -->
        @if (mode() === 'edit' && draft) {
          <div class="toolbar">
            <button class="btn btn--primary" [disabled]="saving()"
                    (click)="saveEdit()">{{ saving() ? 'Saving…' : 'Save changes' }}</button>
            <button class="btn" [disabled]="saving()" (click)="enterView()">Cancel</button>
            <span class="spacer"></span>
            <button class="btn btn--accent" (click)="addMessage()">+ Add message</button>
          </div>

          <div class="field bus-field">
            <label>BUS NAME</label>
            <input [(ngModel)]="draft!.busName" placeholder="e.g. COMFORT_CAN" />
          </div>

          @for (msg of draft!.messages; track $index; let mi = $index) {
            <div class="card edit-card">
              <div class="msg-grid">
                <div class="field">
                  <label>MESSAGE NAME</label>
                  <input [(ngModel)]="msg.name" placeholder="e.g. DOOR_STATUS" />
                </div>
                <div class="field">
                  <label>CAN ID (HEX)</label>
                  <input class="mono" [(ngModel)]="msg.id" placeholder="0x2FC" />
                </div>
                <div class="field">
                  <label>CYCLE MS (EMPTY = EVENT)</label>
                  <input type="number" min="1"
                         [ngModel]="msg.cycleMs" (ngModelChange)="msg.cycleMs = toCycle($event)" />
                </div>
                <button class="btn btn--sm btn--accent" (click)="addSignal(msg)">+ Signal</button>
                <button class="btn btn--sm btn--danger" (click)="removeMessage(mi)">Remove message</button>
              </div>

              @for (sig of msg.signals; track $index; let si = $index) {
                <div class="sig-edit">
                  <div class="sig-grid">
                    <div class="field">
                      <label>SIGNAL NAME</label>
                      <input [(ngModel)]="sig.name" placeholder="e.g. Window_Pos" />
                    </div>
                    <div class="field">
                      <label>BYTE (0-7)</label>
                      <input type="number" min="0" max="7" [(ngModel)]="sig.byteNum" />
                    </div>
                    <div class="field">
                      <label>BIT PATTERN (X/1, BIT 7 → 0)</label>
                      <input class="mono" [(ngModel)]="sig.bit" placeholder="xxxx1111" maxlength="8" />
                    </div>
                    <span class="bits" [title]="'bit pattern ' + sig.bit">
                      @for (cell of bitCells(sig.bit); track $index; let ci = $index) {
                        <button type="button" class="bit bit--click" [class.bit--on]="cell === '1'"
                                [attr.aria-label]="'Toggle bit ' + (7 - ci)"
                                (click)="toggleDraftBit(sig, ci)">{{ cell }}</button>
                      }
                    </span>
                    <button class="btn btn--sm btn--danger" (click)="removeSignal(msg, si)">Remove</button>
                  </div>
                  <div class="sig-meta" style="margin-top: 8px;">
                    mask {{ maskHex(sig.bit) }} · shift {{ shiftOf(sig.bit) }}
                    · {{ widthOf(sig.bit) }} bit(s) · range 0–{{ maxOf(sig.bit) }}
                  </div>

                  <div class="val-edit-list">
                    @for (v of sig.values; track $index; let vi = $index) {
                      <div class="val-edit-row">
                        <div class="field">
                          <label>VALUE</label>
                          <input [(ngModel)]="v.value" placeholder="0" />
                        </div>
                        <div class="field">
                          <label>MEANING</label>
                          <input [(ngModel)]="v.label" placeholder="e.g. Closed" />
                        </div>
                        <button class="val-x" [attr.aria-label]="'Remove value ' + (v.value || 'row')"
                                (click)="removeValue(sig, vi)">✕</button>
                      </div>
                    }
                    <button class="btn--dashed" style="align-self: flex-start;"
                            (click)="addValue(sig)">+ Value</button>
                  </div>
                </div>
              }
            </div>
          }
        }

        <!-- ── Source tab ───────────────────────────────────────────── -->
        @if (mode() === 'source') {
          <div class="toolbar">
            <button class="btn btn--primary" [disabled]="saving() || sourceLoading()"
                    (click)="saveSource()">{{ saving() ? 'Saving…' : 'Save XML' }}</button>
            <button class="btn" [disabled]="saving()" (click)="enterView()">Cancel</button>
            <div class="seg seg--sm" role="group" aria-label="Source view">
              <button [class.active]="srcView === 'preview'" (click)="setSrcView('preview')">Preview</button>
              <button [class.active]="srcView === 'edit'" (click)="setSrcView('edit')">Edit XML</button>
            </div>
            <span class="spacer"></span>
            <div class="seg seg--sm" role="group" aria-label="Highlight theme">
              <button [class.active]="srcTheme === 'editor'" (click)="setSrcTheme('editor')">Editor</button>
              <button [class.active]="srcTheme === 'terminal'" (click)="setSrcTheme('terminal')">Terminal</button>
              <button [class.active]="srcTheme === 'minimal'" (click)="setSrcTheme('minimal')">Minimal</button>
            </div>
            <button class="btn" (click)="copyXml()">{{ copyLabel }}</button>
          </div>

          @if (sourceLoading()) {
            <p class="cd-loading">Loading XML source…</p>
          } @else if (srcView === 'preview') {
            <div class="code" [style.background]="theme['bg']" [style.borderColor]="theme['border']">
              @for (line of srcLines; track line.num) {
                <div class="code-line"><span class="lineno" [style.color]="theme['linenum']">{{ line.num }}</span><span>@for (t of line.tokens; track $index) {<span [style.color]="theme[t.role]">{{ t.text }}</span>}</span></div>
              }
            </div>
          } @else {
            <textarea class="src-textarea" [(ngModel)]="xmlDraft" spellcheck="false"></textarea>
          }
        }
      }
    </div>
  `,
})
export class CatalogDetailPageComponent implements OnInit {
  private readonly http  = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** True when hosted inside the vehicle detail page (hides the back link). */
  @Input() embedded = false;

  /** Filename supplied by a host page instead of the route parameter. */
  @Input() set fileOverride(value: string) {
    if (!value || value === this.filename) return;
    this.filename = value;
    this.loading.set(true);
    this.error.set('');
    this.enterView();
    this.fetchDetail();
  }

  /** Emitted after a successful structured or source save (host shows a toast). */
  @Output() saved = new EventEmitter<void>();

  /** Where Back goes: the page that opened us (the car page passes its own
   *  URL, ?car=<uid> included, so the same car re-selects), else the list. */
  readonly returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');

  goBack(): void {
    this.router.navigateByUrl(this.returnUrl || '/admin/catalogs');
  }

  readonly detail  = signal<CatalogDetail | null>(null);
  readonly loading = signal(true);
  readonly error   = signal('');

  readonly mode          = signal<PageMode>('view');
  readonly saving        = signal(false);
  readonly sourceLoading = signal(false);
  readonly saveError     = signal('');
  readonly saveSuccess   = signal('');

  /** Mutable working copy bound to the edit form; discarded on cancel. */
  draft: CatalogDetail | null = null;
  /** Raw XML text bound to the source textarea. */
  xmlDraft = '';

  // UI-only state: view-tab collapse, values toggles, source presentation.
  private expandedMsgs = new Set<number>();
  private openValues = new Set<string>();
  srcView: SrcView = 'preview';
  srcTheme: SrcTheme = 'editor';
  srcLines: SourceLine[] = [];
  copyLabel = 'Copy';

  private filename = '';
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  readonly signalCount = computed(() =>
    this.detail()?.messages.reduce((acc, m) => acc + m.signals.length, 0) ?? 0);

  get theme(): Record<string, string> {
    return SRC_THEMES[this.srcTheme];
  }

  ngOnInit(): void {
    // The embedded host sets the filename through [fileOverride] (which already
    // fetched); the routed page reads it from the URL.
    if (!this.filename) {
      this.filename = this.route.snapshot.paramMap.get('filename') ?? '';
      this.fetchDetail();
    }
  }

  private fetchDetail(): void {
    this.http.get<CatalogDetail>(
      `${API_BASE_URL}/api/catalogs/${encodeURIComponent(this.filename)}`
    ).subscribe({
      next: d => {
        this.detail.set(d);
        this.loading.set(false);
        this.expandedMsgs = new Set(d.messages.length > 0 ? [0] : []);
        this.openValues.clear();
      },
      error: () => {
        this.error.set(`Could not load catalog "${this.filename}".`);
        this.loading.set(false);
      },
    });
  }

  // ── Mode switching ────────────────────────────────────────────────────────

  enterView(): void {
    this.mode.set('view');
    this.draft = null;
    this.clearBanners();
  }

  enterEdit(): void {
    const d = this.detail();
    if (!d) return;
    this.draft = structuredClone(d);
    this.mode.set('edit');
    this.clearBanners();
  }

  enterSource(): void {
    this.mode.set('source');
    this.srcView = 'preview';
    this.clearBanners();
    this.sourceLoading.set(true);
    this.http.get<{ filename: string; xml: string }>(
      `${API_BASE_URL}/api/catalogs/${encodeURIComponent(this.filename)}/source`
    ).subscribe({
      next: res => {
        this.xmlDraft = res.xml;
        this.refreshSourceLines();
        this.sourceLoading.set(false);
      },
      error: err => {
        this.saveError.set(this.messageOf(err, 'Could not load the XML source.'));
        this.sourceLoading.set(false);
      },
    });
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  saveEdit(): void {
    if (!this.draft || this.saving()) return;
    this.clearBanners();
    this.saving.set(true);
    this.http.put<CatalogDetail>(
      `${API_BASE_URL}/api/catalogs/${encodeURIComponent(this.filename)}`,
      this.draft
    ).subscribe({
      next: d => {
        this.detail.set(d);
        this.saving.set(false);
        this.enterView();
        this.saveSuccess.set('Catalog saved — decoders will pick up the change.');
        this.saved.emit();
      },
      error: err => {
        this.saveError.set(this.messageOf(err, 'Could not save the catalog.'));
        this.saving.set(false);
      },
    });
  }

  saveSource(): void {
    if (this.saving() || this.sourceLoading()) return;
    this.clearBanners();
    this.saving.set(true);
    this.http.put(
      `${API_BASE_URL}/api/catalogs/${encodeURIComponent(this.filename)}/source`,
      { filename: this.filename, xml: this.xmlDraft }
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this.enterView();
        this.saveSuccess.set('XML saved — decoders will pick up the change.');
        this.fetchDetail();
        this.saved.emit();
      },
      error: err => {
        this.saveError.set(this.messageOf(err, 'Could not save the XML.'));
        this.saving.set(false);
      },
    });
  }

  // ── Draft manipulation ────────────────────────────────────────────────────

  addMessage(): void {
    this.draft?.messages.push({ id: '', name: '', cycleMs: null, signals: [] });
  }

  removeMessage(index: number): void {
    this.draft?.messages.splice(index, 1);
  }

  addSignal(msg: MessageDef): void {
    msg.signals.push({ name: '', bit: 'xxxxxxx1', byteNum: 0, values: [] });
  }

  removeSignal(msg: MessageDef, index: number): void {
    msg.signals.splice(index, 1);
  }

  addValue(sig: SignalDef): void {
    sig.values.push({ value: '', label: '' });
  }

  removeValue(sig: SignalDef, index: number): void {
    sig.values.splice(index, 1);
  }

  /** Flip one cell of the draft bit pattern (x ↔ 1) from the clickable grid. */
  toggleDraftBit(sig: SignalDef, index: number): void {
    const cells = this.bitCells(sig.bit);
    cells[index] = cells[index] === '1' ? 'x' : '1';
    sig.bit = cells.join('');
  }

  /** Number input model → cycleMs: empty/invalid/≤0 becomes null (event-driven). */
  toCycle(value: unknown): number | null {
    const n = Number(value);
    return value === null || value === '' || isNaN(n) || n <= 0 ? null : n;
  }

  private clearBanners(): void {
    this.saveError.set('');
    this.saveSuccess.set('');
  }

  private messageOf(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && typeof err.error?.error === 'string') {
      return err.error.error;
    }
    return fallback;
  }

  // ── View-tab collapse state ───────────────────────────────────────────────

  isMsgOpen(mi: number): boolean {
    return this.expandedMsgs.has(mi);
  }

  toggleMsg(mi: number): void {
    if (!this.expandedMsgs.delete(mi)) this.expandedMsgs.add(mi);
  }

  isValuesOpen(mi: number, si: number): boolean {
    return this.openValues.has(mi + '-' + si);
  }

  toggleValues(mi: number, si: number): void {
    const key = mi + '-' + si;
    if (!this.openValues.delete(key)) this.openValues.add(key);
  }

  // ── Source-tab presentation ───────────────────────────────────────────────

  setSrcView(view: SrcView): void {
    this.srcView = view;
    if (view === 'preview') this.refreshSourceLines();
  }

  setSrcTheme(theme: SrcTheme): void {
    this.srcTheme = theme;
  }

  copyXml(): void {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.xmlDraft).catch(() => {});
    }
    this.copyLabel = 'Copied ✓';
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => { this.copyLabel = 'Copy'; }, 1400);
  }

  private refreshSourceLines(): void {
    this.srcLines = this.xmlDraft.split(/\r?\n/)
      .map((line, i) => ({ num: i + 1, tokens: this.tokenizeLine(line) }));
  }

  /** Split one XML line into colored tokens: punct, tag, attr, string, text, decl. */
  private tokenizeLine(line: string): SourceToken[] {
    const out: SourceToken[] = [];
    const push = (text: string, role: TokenRole) => { if (text) out.push({ text, role }); };
    if (line.trim().startsWith('<?')) {
      push(line, 'decl');
      return out;
    }
    let rest = line;
    while (rest.length > 0) {
      const lt = rest.indexOf('<');
      if (lt < 0) { push(rest, 'text'); break; }
      if (lt > 0) { push(rest.slice(0, lt), 'text'); rest = rest.slice(lt); }
      const gt = rest.indexOf('>');
      if (gt < 0) { push(rest, 'text'); break; }
      const tag = rest.slice(0, gt + 1);
      rest = rest.slice(gt + 1);
      const m = /^(<\/?)([\w:.-]+)([\s\S]*?)(\/?>)$/.exec(tag);
      if (!m) { push(tag, 'punct'); continue; }
      push(m[1], 'punct');
      push(m[2], 'tag');
      const attrRe = /(\s+)([\w:.-]+)(=")([^"]*)(")/g;
      let a: RegExpExecArray | null;
      let idx = 0;
      while ((a = attrRe.exec(m[3])) !== null) {
        push(m[3].slice(idx, a.index), 'text');
        push(a[1], 'text');
        push(a[2], 'attr');
        push(a[3], 'punct');
        push(a[4], 'string');
        push(a[5], 'punct');
        idx = a.index + a[0].length;
      }
      push(m[3].slice(idx), 'text');
      push(m[4], 'punct');
    }
    return out;
  }

  // ── Bit-layout helpers ────────────────────────────────────────────────────

  /** 8 cells (bit 7 → bit 0) from an x/1 layout string like "xxxx1111". */
  bitCells(bit: string): string[] {
    const pat = (bit || '').trim().padStart(8, 'x').slice(-8);
    return pat.split('');
  }

  private maskOf(bit: string): number {
    let mask = 0;
    const pat = this.bitCells(bit);
    for (let i = 0; i < 8; i++) {
      if (pat[i] === '1') mask |= 1 << (7 - i);
    }
    return mask;
  }

  shiftOf(bit: string): number {
    const mask = this.maskOf(bit);
    if (mask === 0) return 0;
    return Math.log2(mask & -mask);
  }

  maskHex(bit: string): string {
    return '0x' + this.maskOf(bit).toString(16).toUpperCase().padStart(2, '0');
  }

  widthOf(bit: string): number {
    return this.bitCells(bit).filter(c => c === '1').length;
  }

  maxOf(bit: string): number {
    const w = this.widthOf(bit);
    return w > 0 ? Math.pow(2, w) - 1 : 0;
  }

  /** A raw value rendered as binary at the signal's field width. */
  toBinary(value: string, bit: string): string {
    const n = parseInt(value, 10);
    if (isNaN(n)) return '—';
    const width = Math.max(1, this.widthOf(bit));
    return '0b' + (n >>> 0).toString(2).padStart(width, '0');
  }

  /** True when at least one enum entry has a non-empty value. */
  hasRealValues(sig: SignalDef): boolean {
    return sig.values.some(v => (v.value ?? '').trim() !== '');
  }
}
