import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NlQueryService, NlQueryResponse } from '../../../core/services/nl-query.service';

/**
 * Reusable natural-language ask box: question input + Ask button + a generic
 * result table for whatever rows the NL query service returns. Drop it on any
 * page; pass `scope` to silently constrain questions (e.g. "for session X").
 */
@Component({
  selector: 'app-nl-ask',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .ask-row { display: flex; gap: 0.6rem; align-items: center; }
    .ask-wrap { flex: 1; position: relative; }
    .ask-icon {
      position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
      color: #484f58; pointer-events: none; font-size: 0.8rem;
    }
    .ask-input {
      width: 100%; box-sizing: border-box; background: #0d1117;
      border: 1px solid rgba(176,255,68,0.2); border-radius: 8px; color: #e6edf3;
      font-size: 0.8rem; padding: 9px 12px 9px 34px; outline: none;
    }
    .ask-input:focus { border-color: rgba(176,255,68,0.5); }
    .ask-btn {
      padding: 9px 18px; background: #b0ff44; color: #07090b; border: none;
      border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer;
      white-space: nowrap;
    }
    .ask-btn:disabled { opacity: 0.6; cursor: default; }
    .ask-clear {
      padding: 9px 13px; background: transparent; color: #484f58;
      border: 1px solid #30363d; border-radius: 8px; font-size: 0.78rem; cursor: pointer;
    }
    .ask-error { color: #ff4444; font-size: 0.72rem; margin: 0.5rem 0 0; }

    .res {
      margin-top: 0.8rem; background: #0d1117; border: 1px solid rgba(176,255,68,0.15);
      border-radius: 10px; overflow: hidden;
    }
    .res-head {
      display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap;
      padding: 0.6rem 0.9rem; background: #161b22; border-bottom: 1px solid #21262d;
    }
    .res-type {
      font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em;
      color: #484f58; text-transform: uppercase;
    }
    .res-exp { flex: 1; font-size: 0.72rem; color: #8a9ab0; min-width: 160px; }
    .res-meta { font-size: 0.66rem; color: #484f58; white-space: nowrap; }
    .res-empty { padding: 1rem; color: #484f58; font-size: 0.75rem; text-align: center; margin: 0; }
    .res-scroll { max-height: 320px; overflow: auto; }
    .res-table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }
    .res-table th {
      position: sticky; top: 0; background: #0d1117; text-align: left;
      padding: 6px 10px; color: #8a9ab0; font-weight: 600; text-transform: uppercase;
      font-size: 0.58rem; letter-spacing: 0.06em; border-bottom: 1px solid #21262d;
      white-space: nowrap;
    }
    .res-table td {
      padding: 5px 10px; color: #e6edf3; border-bottom: 1px solid #161b22;
      font-family: ui-monospace, Menlo, monospace; font-size: 0.68rem;
      max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .res-q {
      display: block; padding: 0.5rem 0.9rem; font-size: 0.64rem; color: #b0ff44;
      background: #0a0d10; word-break: break-all; white-space: pre-wrap;
      border-top: 1px solid #161b22;
    }
  `],
  template: `
    <div class="ask-row">
      <div class="ask-wrap">
        <span class="ask-icon">AI</span>
        <input class="ask-input" [(ngModel)]="question" [placeholder]="placeholder()"
          (keydown.enter)="ask()" />
      </div>
      <button class="ask-btn" (click)="ask()" [disabled]="loading()">
        {{ loading() ? 'Thinking…' : 'Ask AI' }}
      </button>
      @if (result() || error()) {
        <button class="ask-clear" (click)="clear()" title="Clear result">✕</button>
      }
    </div>

    @if (error()) { <p class="ask-error">{{ error() }}</p> }

    @if (result(); as r) {
      <div class="res">
        <div class="res-head">
          <span class="res-type">{{ r.queryType === 'flux' ? 'InfluxDB Flux' : 'SQL' }}</span>
          <span class="res-exp">{{ r.explanation }}</span>
          <span class="res-meta">{{ r.rowCount }} rows · {{ r.executionMs }}ms</span>
        </div>
        @if (r.results.length === 0) {
          <p class="res-empty">No results found — try rephrasing the question.</p>
        } @else {
          <div class="res-scroll">
            <table class="res-table">
              <thead>
                <tr>@for (c of columns(); track c) { <th>{{ c }}</th> }</tr>
              </thead>
              <tbody>
                @for (row of r.results; track $index) {
                  <tr>@for (c of columns(); track c) { <td [title]="row[c]">{{ row[c] }}</td> }</tr>
                }
              </tbody>
            </table>
          </div>
        }
        <code class="res-q">{{ r.generatedQuery }}</code>
      </div>
    }
  `,
})
export class NlAskComponent {
  private readonly nlQueryService = inject(NlQueryService);

  placeholder = input('Ask anything about your sessions, cars, or faults…');
  /** Silently appended to the question, e.g. "for session abc123" — lets a page
   *  scope every question to its own context without the user typing it. */
  scope = input('');

  question = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<NlQueryResponse | null>(null);

  readonly columns = computed(() => {
    const rows = this.result()?.results ?? [];
    return rows.length > 0 ? Object.keys(rows[0]) : [];
  });

  ask(): void {
    const q = this.question.trim();
    if (!q || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    const full = this.scope() ? `${q} ${this.scope()}` : q;
    this.nlQueryService.query(full).subscribe({
      next: (r) => { this.result.set(r); this.loading.set(false); },
      error: (e: unknown) => {
        const err = e as { error?: { message?: string }; message?: string };
        this.error.set(err?.error?.message || err?.message || 'Query failed — try rephrasing.');
        this.loading.set(false);
      },
    });
  }

  clear(): void {
    this.result.set(null);
    this.error.set(null);
    this.question = '';
  }
}
