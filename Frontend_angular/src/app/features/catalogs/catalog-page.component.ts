import {
  Component, OnInit, signal, computed,
  ChangeDetectionStrategy, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { API_BASE_URL } from '../../core/config/api.config';

interface CatalogSummary {
  filename: string;
  busName: string;
  messageCount: number;
  signalCount: number;
  fileSize: number;
  lastModified: string;
}

interface SignalValue {
  value: string;
  label: string;
}

interface SignalDef {
  name: string;
  bit: string;
  values: SignalValue[];
}

interface MessageDef {
  id: string;
  name: string;
  signals: SignalDef[];
}

interface CatalogDetail {
  filename: string;
  busName: string;
  messages: MessageDef[];
}

@Component({
  selector: 'app-catalog-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, HttpClientModule],
  styles: [`
    .page { 
      display: flex; height: 100vh; background: #07090b; 
      font-family: system-ui, sans-serif;
    }

    /* ── Left panel ── */
    .left {
      width: 300px; flex-shrink: 0;
      background: #0d1117;
      border-right: 1px solid rgba(176,255,68,0.08);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .left-header {
      padding: 1rem;
      border-bottom: 1px solid rgba(176,255,68,0.08);
      display: flex; flex-direction: column; gap: 0.75rem;
    }
    .left-title {
      font-size: 0.65rem; font-weight: 700;
      letter-spacing: 0.18em; color: #b0ff44;
      text-transform: uppercase;
    }
    .upload-btn {
      width: 100%; padding: 8px;
      background: rgba(176,255,68,0.08);
      border: 1px dashed rgba(176,255,68,0.3);
      border-radius: 6px; color: #b0ff44;
      font-size: 0.75rem; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
      text-align: center;
    }
    .upload-btn:hover {
      background: rgba(176,255,68,0.15);
    }
    .reload-btn {
      width: 100%; padding: 6px;
      background: transparent;
      border: 1px solid #21262d;
      border-radius: 6px; color: #484f58;
      font-size: 0.72rem; cursor: pointer;
      transition: all 0.2s;
    }
    .reload-btn:hover { color: #8a9ab0; border-color: #30363d; }

    /* ── Catalog cards ── */
    .catalog-list {
      flex: 1; overflow-y: auto; padding: 0.5rem;
    }
    .catalog-card {
      padding: 0.75rem;
      border: 1px solid #21262d;
      border-radius: 8px; margin-bottom: 0.5rem;
      cursor: pointer; transition: all 0.15s;
      background: transparent;
    }
    .catalog-card:hover {
      background: #161b22;
      border-color: rgba(176,255,68,0.2);
    }
    .catalog-card.selected {
      background: #161b22;
      border-color: #b0ff44;
    }
    .card-top {
      display: flex; align-items: center;
      justify-content: space-between; gap: 0.5rem;
    }
    .card-filename {
      font-size: 0.78rem; font-weight: 600;
      color: #e6edf3; font-family: monospace;
      overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-delete {
      background: none; border: none;
      color: #484f58; cursor: pointer;
      font-size: 0.8rem; padding: 2px 4px;
      border-radius: 3px; flex-shrink: 0;
      transition: color 0.2s;
    }
    .card-delete:hover { color: #ff4444; }
    .card-bus {
      font-size: 0.68rem; color: #b0ff44;
      margin-top: 0.25rem;
    }
    .card-stats {
      display: flex; gap: 0.75rem;
      margin-top: 0.4rem;
    }
    .card-stat {
      font-size: 0.65rem; color: #484f58;
    }
    .card-stat span { color: #8a9ab0; font-weight: 600; }
    .card-date {
      font-size: 0.62rem; color: #30363d;
      margin-top: 0.25rem;
    }

    /* ── Right panel ── */
    .right {
      flex: 1; display: flex; flex-direction: column;
      overflow: hidden;
    }
    .right-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid rgba(176,255,68,0.08);
      display: flex; align-items: center;
      justify-content: space-between;
    }
    .right-title {
      font-size: 1rem; font-weight: 700; color: #e6edf3;
    }
    .right-sub {
      font-size: 0.72rem; color: #484f58; margin-top: 0.2rem;
    }
    .right-body {
      flex: 1; overflow-y: auto; padding: 1.5rem;
    }

    /* ── Empty state ── */
    .empty {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      height: 100%; color: #484f58; gap: 0.75rem;
    }
    .empty svg { opacity: 0.3; }
    .empty p { font-size: 0.82rem; }

    /* ── Message tree ── */
    .msg-block {
      background: #0d1117;
      border: 1px solid rgba(176,255,68,0.08);
      border-radius: 8px; margin-bottom: 0.75rem;
      overflow: hidden;
    }
    .msg-header {
      display: flex; align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      cursor: pointer;
      transition: background 0.15s;
      user-select: none;
    }
    .msg-header:hover { background: #161b22; }
    .msg-header-left {
      display: flex; align-items: center; gap: 0.75rem;
    }
    .msg-id {
      font-family: monospace; font-size: 0.78rem;
      color: #b0ff44; font-weight: 700;
      background: rgba(176,255,68,0.08);
      padding: 2px 8px; border-radius: 4px;
    }
    .msg-name {
      font-size: 0.82rem; font-weight: 600;
      color: #e6edf3;
    }
    .msg-sig-count {
      font-size: 0.65rem; color: #484f58;
    }
    .msg-chevron {
      font-size: 0.7rem; color: #484f58;
      transition: transform 0.2s;
    }
    .msg-chevron.open { transform: rotate(90deg); }

    /* ── Signal table ── */
    .sig-table-wrap {
      border-top: 1px solid #21262d;
      padding: 0.75rem 1rem;
    }
    .sig-row {
      display: grid;
      grid-template-columns: 180px 90px 1fr;
      gap: 0.5rem; align-items: start;
      padding: 0.5rem 0;
      border-bottom: 1px solid #161b22;
      font-size: 0.75rem;
    }
    .sig-row:last-child { border-bottom: none; }
    .sig-name { color: #e6edf3; font-weight: 600; }
    .sig-bit {
      font-family: monospace; font-size: 0.68rem;
      color: #484f58; letter-spacing: 0.05em;
    }
    .sig-values {
      display: flex; flex-wrap: wrap; gap: 0.3rem;
    }
    .val-pill {
      background: #161b22; border: 1px solid #21262d;
      border-radius: 4px; padding: 1px 6px;
      font-size: 0.62rem; color: #8a9ab0;
    }
    .val-pill span { color: #b0ff44; margin-right: 3px; }

    /* ── Loading / status ── */
    .loading {
      color: #484f58; font-size: 0.78rem;
      padding: 2rem; text-align: center;
    }
    .error-msg {
      color: #ff4444; font-size: 0.75rem;
      padding: 0.5rem 1rem;
      background: rgba(255,68,68,0.08);
      border-radius: 6px; margin-bottom: 0.75rem;
    }
    .success-msg {
      color: #b0ff44; font-size: 0.75rem;
      padding: 0.5rem 1rem;
      background: rgba(176,255,68,0.08);
      border-radius: 6px; margin-bottom: 0.75rem;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #21262d; border-radius: 2px; }
  `],
  template: `
    <div class="page">

      <!-- ══ LEFT PANEL ══ -->
      <aside class="left">
        <div class="left-header">
          <span class="left-title">ECU Catalogs</span>
          <label class="upload-btn">
            <input type="file" accept=".xml"
              style="display:none"
              (change)="onFileSelected($event)"/>
            ＋ Upload XML Catalog
          </label>
          <button class="reload-btn" (click)="reloadCatalogs()">
            ↻ Reload all catalogs
          </button>
          @if (statusMsg()) {
            <div [class]="statusIsError() ? 'error-msg' : 'success-msg'">
              {{ statusMsg() }}
            </div>
          }
        </div>

        <div class="catalog-list">
          @if (loadingList()) {
            <p class="loading">Loading catalogs...</p>
          }
          @for (cat of catalogs(); track cat.filename) {
            <div class="catalog-card"
              [class.selected]="selectedFilename() === cat.filename"
              (click)="selectCatalog(cat.filename)">
              <div class="card-top">
                <span class="card-filename">{{ cat.filename }}</span>
                <button class="card-delete"
                  title="Open decoded view"
                  style="color:#b0ff44;"
                  (click)="openFullView(cat.filename, $event)">
                  ↗
                </button>
                <button class="card-delete"
                  title="Delete catalog"
                  (click)="deleteCatalog(cat.filename, $event)">
                  ✕
                </button>
              </div>
              <div class="card-bus">{{ cat.busName }}</div>
              <div class="card-stats">
                <div class="card-stat">
                  <span>{{ cat.messageCount }}</span> messages
                </div>
                <div class="card-stat">
                  <span>{{ cat.signalCount }}</span> signals
                </div>
                <div class="card-stat">
                  <span>{{ formatSize(cat.fileSize) }}</span>
                </div>
              </div>
              <div class="card-date">Modified: {{ cat.lastModified }}</div>
            </div>
          }
          @if (!loadingList() && catalogs().length === 0) {
            <p class="loading">No catalogs found</p>
          }
        </div>
      </aside>

      <!-- ══ RIGHT PANEL ══ -->
      <main class="right">
        <!-- Stat cards -->
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:0.75rem;
          padding:1rem 1.5rem; border-bottom:1px solid rgba(176,255,68,0.06); flex-shrink:0;">
          <div style="background:#07090b; border:1px solid #21262d; border-radius:8px; padding:0.75rem 1rem;">
            <div style="font-size:0.62rem; color:#484f58; text-transform:uppercase; letter-spacing:0.08em;">Catalogs</div>
            <div style="font-size:1.4rem; font-weight:700; color:#b0ff44; margin-top:4px;">{{ catalogs().length }}</div>
          </div>
          <div style="background:#07090b; border:1px solid #21262d; border-radius:8px; padding:0.75rem 1rem;">
            <div style="font-size:0.62rem; color:#484f58; text-transform:uppercase; letter-spacing:0.08em;">Messages</div>
            <div style="font-size:1.4rem; font-weight:700; color:#e6edf3; margin-top:4px;">{{ allMessages() }}</div>
          </div>
          <div style="background:#07090b; border:1px solid #21262d; border-radius:8px; padding:0.75rem 1rem;">
            <div style="font-size:0.62rem; color:#484f58; text-transform:uppercase; letter-spacing:0.08em;">Signals</div>
            <div style="font-size:1.4rem; font-weight:700; color:#e6edf3; margin-top:4px;">{{ allSignals() }}</div>
          </div>
        </div>

        @if (!selectedFilename()) {
          <div class="empty">
            <svg width="48" height="48" fill="none" stroke="currentColor"
              stroke-width="1" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <p>Select a catalog to view its messages and signals</p>
          </div>
        } @else if (loadingDetail()) {
          <p class="loading">Loading catalog detail...</p>
        } @else if (detail()) {
          <div class="right-header">
            <div>
              <div class="right-title">{{ detail()!.filename }}</div>
              <div class="right-sub">
                Bus: {{ detail()!.busName }} ·
                {{ detail()!.messages.length }} messages ·
                {{ totalSignals() }} signals
              </div>
            </div>
          </div>
          <div class="right-body">
            @for (msg of detail()!.messages; track msg.id) {
              <div class="msg-block">
                <div class="msg-header"
                  (click)="toggleMessage(msg.id)">
                  <div class="msg-header-left">
                    <span class="msg-id">{{ msg.id }}</span>
                    <span class="msg-name">{{ msg.name }}</span>
                    <span class="msg-sig-count">
                      {{ msg.signals.length }} signals
                    </span>
                  </div>
                  <span class="msg-chevron"
                    [class.open]="isMessageOpen(msg.id)">
                    ▶
                  </span>
                </div>
                @if (isMessageOpen(msg.id)) {
                  <div class="sig-table-wrap">
                    @for (sig of msg.signals; track sig.name) {
                      <div class="sig-row">
                        <span class="sig-name">{{ sig.name }}</span>
                        <span class="sig-bit">{{ sig.bit }}</span>
                        <div class="sig-values">
                          @for (v of sig.values; track v.value) {
                            <span class="val-pill">
                              <span>{{ v.value }}</span>{{ v.label }}
                            </span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </main>

    </div>
  `
})
export class CatalogPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly catalogs       = signal<CatalogSummary[]>([]);
  readonly loadingList    = signal(false);
  readonly selectedFilename = signal<string | null>(null);
  readonly detail         = signal<CatalogDetail | null>(null);
  readonly loadingDetail  = signal(false);
  readonly statusMsg      = signal<string | null>(null);
  readonly statusIsError  = signal(false);
  private openMessages    = new Set<string>();

  readonly totalSignals = computed(() =>
    this.detail()?.messages.reduce(
      (sum, m) => sum + m.signals.length, 0
    ) ?? 0
  );

  readonly allMessages = computed(() =>
    this.catalogs().reduce((sum, c) => sum + c.messageCount, 0)
  );
  readonly allSignals = computed(() =>
    this.catalogs().reduce((sum, c) => sum + c.signalCount, 0)
  );

  ngOnInit(): void {
    this.loadCatalogs();
  }

  loadCatalogs(): void {
    this.loadingList.set(true);
    this.http.get<CatalogSummary[]>(
      `${API_BASE_URL}/api/catalogs`,
      { headers: this.h() }
    ).subscribe({
      next: list => {
        this.catalogs.set(list);
        this.loadingList.set(false);
      },
      error: () => this.loadingList.set(false)
    });
  }

  /** Navigate to the full decoded view of a catalog file. */
  openFullView(filename: string, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/admin/catalogs', filename]);
  }

  selectCatalog(filename: string): void {
    if (this.selectedFilename() === filename) return;
    this.selectedFilename.set(filename);
    this.detail.set(null);
    this.openMessages.clear();
    this.loadingDetail.set(true);
    this.http.get<CatalogDetail>(
      `${API_BASE_URL}/api/catalogs/${encodeURIComponent(filename)}`,
      { headers: this.h() }
    ).subscribe({
      next: d => {
        this.detail.set(d);
        // Auto-open all messages
        d.messages.forEach(m => this.openMessages.add(m.id));
        this.loadingDetail.set(false);
      },
      error: () => this.loadingDetail.set(false)
    });
  }

  toggleMessage(id: string): void {
    if (this.openMessages.has(id)) {
      this.openMessages.delete(id);
    } else {
      this.openMessages.add(id);
    }
    // Force re-render
    this.detail.update(d => d ? { ...d } : d);
  }

  isMessageOpen(id: string): boolean {
    return this.openMessages.has(id);
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.xml')) {
      this.showStatus('Only .xml files are accepted', true);
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    this.http.post<any>(
      `${API_BASE_URL}/api/catalogs/upload`,
      formData,
      { headers: this.h() }
    ).subscribe({
      next: () => {
        this.showStatus(`✓ ${file.name} uploaded successfully`, false);
        this.loadCatalogs();
      },
      error: err => this.showStatus(
        err?.error?.error ?? 'Upload failed', true
      )
    });
  }

  deleteCatalog(filename: string, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Delete ${filename}? This cannot be undone.`)) return;
    this.http.delete<any>(
      `${API_BASE_URL}/api/catalogs/${encodeURIComponent(filename)}`,
      { headers: this.h() }
    ).subscribe({
      next: () => {
        this.showStatus(`✓ ${filename} deleted`, false);
        if (this.selectedFilename() === filename) {
          this.selectedFilename.set(null);
          this.detail.set(null);
        }
        this.loadCatalogs();
      },
      error: () => this.showStatus('Delete failed', true)
    });
  }

  reloadCatalogs(): void {
    this.http.post<any>(
      `${API_BASE_URL}/api/catalogs/reload`,
      {},
      { headers: this.h() }
    ).subscribe({
      next: res => this.showStatus(
        `✓ Reloaded — ${res.signals} signals, ${res.messages} cyclic messages`,
        false
      ),
      error: () => this.showStatus('Reload failed', true)
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(1) + ' KB';
  }

  private showStatus(msg: string, isError: boolean): void {
    this.statusMsg.set(msg);
    this.statusIsError.set(isError);
    setTimeout(() => this.statusMsg.set(null), 4000);
  }

  private h(): HttpHeaders {
    const token = localStorage.getItem('access_token');
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }
}
