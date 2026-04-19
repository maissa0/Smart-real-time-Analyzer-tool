import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { AnomalyPanelComponent } from '../anomaly-panel/anomaly-panel.component';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import {
  Component, OnDestroy, OnInit, inject, NgZone,
  ChangeDetectorRef, HostListener, ViewChild, ElementRef
} from '@angular/core';
import { Router } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { DashboardStateService } from '../services/dashboard-state.service';
import { API_BASE_URL } from '../config/api.config';

Chart.register(...registerables, zoomPlugin);

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ParsedSignalEntry {
  name: string;
  value: string;
  rawVal: string;
  isValid: boolean;
}

interface ParsedFrame {
  id: number;
  timestamp: number;
  channel: number;
  address: string;
  bus: string;
  message: string;
  direction: string;
  rawData: number[];
  signals: Record<string, any>;
  parsedSignals: ParsedSignalEntry[];
}

interface SignalDef {
  signalName: string;
  color: string;
  allStates: Record<number, string>;
}

interface ChartCard {
  cardId: string;
  title: string;
  signals: SignalDef[];
  defVals: number[];
  vm: Record<number, string>;
  chart?: Chart;
}

interface SignalNode {
  name: string;
  checked: boolean;
}

interface MsgTreeNode {
  messageName: string;
  address: string;
  expanded: boolean;
  signals: SignalNode[];
}

interface MessageGroup {
  messageName: string;
  address: string;
  visible: boolean;
  cards: ChartCard[];
}

interface ErrorReport {
  parseErrors:    { line: number; content: string; reason: string }[];
  invalidSignals: { frame: number; timestamp: number; signal: string; rawValue: number; reason: string }[];
  xmlErrors:      { file: string; reason: string }[];
  summary: {
    parseErrorCount: number;
    invalidSignalCount: number;
    xmlErrorCount: number;
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, AnomalyPanelComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly http       = inject(HttpClient);
  private readonly auth       = inject(AuthService);
  private readonly router     = inject(Router);
  private readonly zone       = inject(NgZone);
  private readonly cdr        = inject(ChangeDetectorRef);
  private readonly dashState$ = inject(DashboardStateService);

  username    = '';
  sidebarOpen = false;
  isAdmin     = false;

  // WebSocket client for 60Hz batch delivery
  private stompClient?: Client;

  // Upload — log file only (XML auto-discovered server-side)
  logFile: File | null = null;
  isDragOverLog = false;
  analyzing     = false;
  analyzeError  = '';

  // Analyze mode
  analyzeMode: 'stream' | 'batch' = 'batch';

  // Streaming speed (delay in ms between rendered frames; default 1x)
  streamDelay = 1000;
  readonly speedOptions: { label: string; delay: number }[] = [
    { label: '0.5x', delay: 2000 },
    { label: '1x',   delay: 1000 },
    { label: '2x',   delay:  500 },
    { label: '5x',   delay:  200 },
    { label: '⚡',   delay:    0 },
  ];

  // Streaming progress
  streamingFrameCount = 0;
  streamingDone       = false;

  // View
  activeView: 'table' | 'charts' | '3d' = 'table';
  chartMode: 'grouped' | 'separate' = 'grouped';

  // Results
  showResults    = false;
  allFrames: ParsedFrame[]      = [];
  filteredFrames: ParsedFrame[] = [];

  // Error report
  errorReport: ErrorReport | null = null;
  frontendErrors: { timestamp: string; location: string; error: string; message: string; cause?: string }[] = [];
  xmlFilesUsed: string[] = [];

  // Filters
  filterAddress = '';
  filterBus     = '';

  // Message/Signal tree
  msgTree: MsgTreeNode[] = [];

  // Charts
  messageGroups: MessageGroup[] = [];
  chartsRendered = false;

  // Expand overlay
  expandedCard: ChartCard | null = null;
  expandedCardMsgName = '';
  private expandedChartInst?: Chart;

  private logStartTs = 0;

  // Chart throttle
  private chartUpdatePending = false;
  private chartUpdateTimer?: any;

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  @ViewChild('framesWrap') framesWrap?: ElementRef<HTMLDivElement>;
  autoScroll = true;

  // ── Unity 3D panel ───────────────────────────────────────────────────────
  unityConnected = false;
  unityMode: 'live' | 'replay' | null = null;
  replaySpeed    = 1;
  readonly replaySpeedOptions = [0.5, 1, 2, 5];
  private _statusInterval: any;

  // Replay progress
  replayInProgress   = false;
  replayCurrentFrame = 0;
  replayTotal        = 0;
  replayDone         = false;
  private replayAbort = false;

  // Live forwarding to Unity
  liveSendingToUnity = false;

  private readonly PAL = [
    '#b0ff44','#60cfff','#ffb347','#ff6b9d',
    '#c77dff','#4cc9f0','#f72585','#7bed9f',
    '#ffd700','#ff4757','#2ed573','#1e90ff'
  ];

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.username = this.auth.getCurrentUser() ?? 'user';
    this.isAdmin  = this.auth.isAdmin();
    this.restoreState();
  }

  ngOnDestroy(): void {
    this.saveState();
    this.destroyAllCharts();
    if (this.chartUpdateTimer) clearTimeout(this.chartUpdateTimer);
    if (this._statusInterval) clearInterval(this._statusInterval);
    this.stompClient?.deactivate();
  }

  private saveState(): void {
    this.dashState$.snapshot = {
      showResults:         this.showResults,
      activeView:          this.activeView,
      chartMode:           this.chartMode,
      allFrames:           this.allFrames,
      filteredFrames:      this.filteredFrames,
      msgTree:             this.msgTree,
      messageGroups:       this.messageGroups.map(g => ({
        ...g,
        cards: g.cards.map((c: any) => {
          const { chart, ...rest } = c;
          return rest;
        }),
      })),
      logStartTs:          this.logStartTs,
      filterAddress:       this.filterAddress,
      filterBus:           this.filterBus,
      errorReport:         this.errorReport,
      xmlFilesUsed:        this.xmlFilesUsed,
      logFile:             this.logFile,
      logFileName:         this.logFile?.name ?? '',
      streamingFrameCount: this.streamingFrameCount,
      streamingDone:       this.streamingDone,
      analyzeMode:         this.analyzeMode,
    };
  }

  private restoreState(): void {
    const snap = this.dashState$.snapshot;
    if (!snap || snap.allFrames.length === 0) return;

    this.showResults         = snap.showResults;
    this.activeView          = snap.activeView;
    this.chartMode           = snap.chartMode;
    this.allFrames           = snap.allFrames;
    this.filteredFrames      = snap.filteredFrames;
    this.msgTree             = snap.msgTree;
    this.messageGroups       = snap.messageGroups;
    this.logStartTs          = snap.logStartTs;
    this.filterAddress       = snap.filterAddress;
    this.filterBus           = snap.filterBus;
    this.errorReport         = snap.errorReport;
    this.xmlFilesUsed        = snap.xmlFilesUsed;
    this.logFile             = snap.logFile;
    this.streamingFrameCount = snap.streamingFrameCount;
    this.streamingDone       = snap.streamingDone;
    this.analyzeMode         = snap.analyzeMode;

    this.cdr.detectChanges();
    if (this.activeView === 'charts' && this.showResults) {
      setTimeout(() => this.renderAllCharts(), 150);
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.closeExpanded(); }

  // ─── Navigation ──────────────────────────────────────────────────────────

  toggleSidebar():   void { this.sidebarOpen = !this.sidebarOpen; }
  logout():          void { this.auth.logout(); this.router.navigate(['/login']); }
  goToUsers():       void { this.router.navigate(['/users']); }
  goToSimulator():   void { this.router.navigate(['/simulator']); }
  goToProfile():     void { this.router.navigate(['/profile']); }

  // ─── Upload (log file only) ───────────────────────────────────────────────

  onLogFileSelect(e: Event): void {
    this.logFile = (e.target as HTMLInputElement).files?.[0] ?? null;
  }

  onDragOverLog(e: DragEvent):  void { e.preventDefault(); this.isDragOverLog = true; }
  onDragLeaveLog(e: DragEvent): void { e.preventDefault(); this.isDragOverLog = false; }
  onDropLog(e: DragEvent): void {
    e.preventDefault(); this.isDragOverLog = false;
    const f = e.dataTransfer?.files?.[0] ?? null;
    if (f) this.logFile = f;
  }

  canAnalyze(): boolean {
    return !!this.logFile && !this.analyzing;
  }

  // ─── Analyze ─────────────────────────────────────────────────────────────

  setAnalyzeMode(mode: 'stream' | 'batch'): void { this.analyzeMode = mode; }

  analyze(): void {
    if (!this.canAnalyze()) return;
    this.dashState$.clear();
    this.autoScroll          = true;
    this.analyzing           = true;
    this.analyzeError        = '';
    this.showResults         = false;
    this.streamingFrameCount = 0;
    this.streamingDone       = false;
    this.allFrames           = [];
    this.filteredFrames      = [];
    this.messageGroups       = [];
    this.msgTree             = [];
    this.errorReport         = null;
    this.frontendErrors      = [];
    this.xmlFilesUsed        = [];
    this.destroyAllCharts();
    if (this.analyzeMode === 'stream') this.analyzeStream();
    else                               this.analyzeBatch();
  }

  // ─── STREAMING MODE ───────────────────────────────────────────────────────

  private analyzeStream(): void {
    const fd = new FormData();
    fd.append('logFile', this.logFile!);

    const token = this.auth.getToken();
    const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

    fetch(`${API_BASE_URL}/api/analyze-stream`, { method: 'POST', body: fd, headers })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error('No response body');

        this.zone.run(() => {
          this.showResults = true;
          this.activeView  = 'table';
          this.cdr.detectChanges();
        });

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = '';

        const pump = async (): Promise<void> => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              this.handleSseLine(trimmed);
              if (this.streamDelay > 0
                  && trimmed.startsWith('data:')
                  && trimmed.includes('"timestamp"')) {
                await new Promise<void>(r => setTimeout(r, this.streamDelay));
              }
            }
          }
        };

        return pump();
      })
      .catch(err => {
        this.zone.run(() => {
          this.recordFrontendError('analyzeStream.fetch', err);
          this.analyzeError = err?.message ?? 'Streaming failed.';
          this.analyzing    = false;
          this.cdr.detectChanges();
        });
      });
  }

  private handleSseLine(line: string): void {
    if (!line) return;

    if (line.startsWith('event:')) return; // skip event name lines

    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (!payload) return;

      try {
        const parsed = JSON.parse(payload);

        if (parsed.done === true) {
          this.zone.run(() => {
            this.analyzing         = false;
            this.streamingDone     = true;
            this.liveSendingToUnity = false;
            this.cdr.detectChanges();
          });
          return;
        }

        // Error report event
        if (parsed.parseErrors !== undefined || parsed.summary !== undefined) {
          this.zone.run(() => {
            this.errorReport = parsed;
            this.cdr.detectChanges();
          });
          return;
        }

        // Decoded frame
        if (parsed.timestamp !== undefined) {
          this.zone.run(() => { this.onFrameReceived(parsed); });
        }

      } catch { /* ignore malformed lines */ }
    }
  }

  // ─── BATCH MODE ──────────────────────────────────────────────────────────

  private analyzeBatch(): void {
    // Generate a unique session ID so we can subscribe to the right WebSocket topic
    // BEFORE uploading the file.  This eliminates any subscription race condition:
    // we are already subscribed when the server starts pushing at 60Hz.
    const sessionId = crypto.randomUUID();

    const token = this.auth.getToken();
    const authHeaders: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

    // Tear down any previous STOMP client
    this.stompClient?.deactivate();

    this.stompClient = new Client({
      webSocketFactory: () => new SockJS(`${API_BASE_URL}/ws`),
      reconnectDelay: 0,   // no auto-reconnect for one-shot batch delivery

      onConnect: () => {
        // Subscribe first, then upload — no frames can arrive before we are ready
        this.stompClient!.subscribe(
          `/topic/batch-frames/${sessionId}`,
          message => {
            const payload = JSON.parse(message.body);
            this.zone.run(() => {
              const rawFrames: any[] = payload.frames ?? [];
              rawFrames.forEach(raw => this.onFrameReceived(raw));

              if (payload.done) {
                this.errorReport  = payload.errorReport ?? null;
                this.showResults   = true;
                this.activeView    = 'table';
                this.analyzing     = false;
                this.streamingDone = true;
                this.buildMessageGroups();
                this.stompClient?.deactivate();
                this.cdr.detectChanges();
              }
            });
          }
        );

        // Now upload the file — server will push frames to our topic
        const fd = new FormData();
        fd.append('logFile', this.logFile!);
        fd.append('sessionId', sessionId);

        fetch(`${API_BASE_URL}/api/analyze`, { method: 'POST', body: fd, headers: authHeaders })
          .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((result: any) => {
            this.zone.run(() => {
              // HTTP response contains metadata only (no frames — those come via WS)
              this.xmlFilesUsed = result.xmlFilesUsed ?? [];
              this.cdr.detectChanges();
            });
          })
          .catch(err => {
            this.zone.run(() => {
              this.recordFrontendError('analyzeBatch.fetch', err);
              this.analyzeError = err?.message ?? 'Batch analysis failed.';
              this.analyzing    = false;
              this.stompClient?.deactivate();
              this.cdr.detectChanges();
            });
          });
      },

      onStompError: frame => {
        this.zone.run(() => {
          this.analyzeError = `WebSocket error: ${frame.headers['message'] ?? 'unknown'}`;
          this.analyzing    = false;
          this.cdr.detectChanges();
        });
      }
    });

    this.stompClient.activate();
  }

  // ─── Frame received (streaming) ───────────────────────────────────────────

  private onFrameReceived(raw: any): void {
    const frameId = this.allFrames.length;
    const frame   = this.mapFrame(raw, frameId);

    if (this.allFrames.length === 0) this.logStartTs = frame.timestamp;

    this.allFrames.push(frame);
    this.streamingFrameCount = this.allFrames.length;
    this.updateMsgTree(frame);

    if (this.frameMatchesFilters(frame)) {
      this.filteredFrames = [...this.filteredFrames, frame];
    }

    this.onFrameUpdateCharts(frame);

    if (this.autoScroll && this.activeView === 'table') {
      // Defer one microtask so the new <tr> is in the DOM before we measure scrollHeight
      setTimeout(() => this.scrollToBottom(), 0);
    }

    // Forward to Unity in live mode
    if (this.unityMode === 'live' && this.liveSendingToUnity) {
      this.http.post(`${API_BASE_URL}/api/unity/frame`, raw).subscribe();
    }

    this.cdr.detectChanges();
  }

  // ─── Map raw API frame to ParsedFrame ─────────────────────────────────────

  private mapFrame(f: any, i: number): ParsedFrame {
    return {
      id:           i,
      timestamp:    Number(f.timestamp),
      channel:      Number(f.channel   ?? 0),
      address:      String(f.address   ?? ''),
      bus:          String(f.bus       ?? ''),
      message:      String(f.message   ?? ''),
      direction:    String(f.direction ?? ''),
      rawData:      Array.isArray(f.raw_data) ? f.raw_data : [],
      signals:      f.signals ?? {},
      parsedSignals: this.parseSignalsFromRaw(f.signals ?? {})
    };
  }

  // ─── Error recording ──────────────────────────────────────────────────────

  private recordFrontendError(location: string, err: any): void {
    this.frontendErrors.push({
      timestamp: new Date().toISOString(),
      location,
      error:   err?.name ?? err?.constructor?.name ?? 'Error',
      message: err?.message ?? String(err),
      cause:   err?.cause ? String(err.cause) : undefined
    });
  }

  // ─── Error report download ────────────────────────────────────────────────

  get totalErrorCount(): number {
    const be = this.errorReport?.summary
      ? (this.errorReport.summary.parseErrorCount +
         this.errorReport.summary.invalidSignalCount +
         this.errorReport.summary.xmlErrorCount)
      : 0;
    return be + this.frontendErrors.length;
  }

  downloadErrorReport(): void {
    const report = {
      session: {
        timestamp:    new Date().toISOString(),
        logFile:      this.logFile?.name ?? 'unknown',
        xmlFilesUsed: this.xmlFilesUsed,
        mode:         'stream'
      },
      summary: {
        totalFrames:        this.allFrames.length,
        backendParseErrors: this.errorReport?.summary?.parseErrorCount    ?? 0,
        invalidSignals:     this.errorReport?.summary?.invalidSignalCount ?? 0,
        xmlErrors:          this.errorReport?.summary?.xmlErrorCount      ?? 0,
        frontendErrors:     this.frontendErrors.length
      },
      backendReport:  this.errorReport,
      frontendErrors: this.frontendErrors
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `error_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Chart update on incoming frame (streaming) ───────────────────────────

  private onFrameUpdateCharts(frame: ParsedFrame): void {
    if (frame.message === 'Unknown') return;

    let group = this.messageGroups.find(g => g.messageName === frame.message);

    if (!group) {
      group = {
        messageName: frame.message,
        address:     frame.address,
        visible:     true,
        cards:       this.buildCardsForMessage(frame.message, frame.address, frame.signals)
      };
      this.messageGroups = [...this.messageGroups, group];
      this.cdr.detectChanges();
      setTimeout(() => {
        this.initChartsForGroup(group!);
        this.appendFrameToGroupCharts(group!, frame);
      }, 50);
      return;
    }

    this.appendFrameToGroupCharts(group, frame);
    this.scheduleChartUpdate();
  }

  private scheduleChartUpdate(): void {
    if (this.chartUpdatePending) return;
    this.chartUpdatePending = true;
    this.chartUpdateTimer = setTimeout(() => {
      for (const g of this.messageGroups) {
        for (const card of g.cards) card.chart?.update('none');
      }
      this.chartUpdatePending = false;
    }, 100);
  }

  private initChartsForGroup(group: MessageGroup): void {
    for (const card of group.cards) {
      const canvas = document.getElementById(card.cardId) as HTMLCanvasElement | null;
      if (canvas) card.chart = this.buildEmptyChart(canvas, card, group.messageName);
    }
  }

  private appendFrameToGroupCharts(group: MessageGroup, frame: ParsedFrame): void {
    for (const card of group.cards) {
      if (!card.chart) continue;
      let changed = false;

      card.signals.forEach((sigDef, datasetIdx) => {
        const sd = frame.signals[sigDef.signalName];
        if (!sd || sd.is_valid === false) return;

        const dataset = card.chart!.data.datasets[datasetIdx];
        const data    = dataset.data as { x: number; y: number }[];
        const ds: any = dataset;
        const pR      = ds.pointRadius as number[];
        const pC      = ds.pointBackgroundColor as string[];

        // Remove previous tail
        if (data.length > 0 && (data[data.length - 1] as any)._tail) {
          data.pop(); pR.pop(); pC.pop();
        }

        // Add real point
        data.push({ x: frame.timestamp, y: Number(sd.raw_value ?? 0) });
        pR.push(2); pC.push(sigDef.color);

        // Add new tail
        const tailPt: any = { x: frame.timestamp + 1, y: Number(sd.raw_value ?? 0), _tail: true };
        data.push(tailPt); pR.push(0); pC.push('transparent');

        changed = true;
      });

      if (changed) card.chart.update('none');
    }
  }

  // ─── View switching ───────────────────────────────────────────────────────

  switchView(view: 'table' | 'charts' | '3d'): void {
    const leaving3d = this.activeView === '3d' && view !== '3d';
    const entering3d = view === '3d' && this.activeView !== '3d';
    this.activeView = view;
    if (entering3d) {
      this.pollUnityStatus();
      this._statusInterval = setInterval(() => this.pollUnityStatus(), 3000);
    }
    if (leaving3d) {
      clearInterval(this._statusInterval);
    }
    if (view === 'charts') setTimeout(() => this.renderAllCharts(), 80);
  }

  setChartMode(mode: 'grouped' | 'separate'): void {
    if (this.chartMode === mode) return;
    this.chartMode = mode;
    this.buildMessageGroups();
    if (this.activeView === 'charts') setTimeout(() => this.renderAllCharts(), 80);
  }

  // ─── State key — compares numeric keys AND label values ──────────────────

  private stateKey(v: Record<number, string>): string {
    return Object.keys(v).map(Number).sort((a, b) => a - b)
      .map(k => `${k}=${v[k]}`).join('|');
  }

  // ─── Build message groups & chart cards ───────────────────────────────────

  buildMessageGroups(): void {
    const msgMap = new Map<string, { address: string; signals: Map<string, Record<number, string>> }>();

    for (const frame of this.allFrames) {
      if (!msgMap.has(frame.message))
        msgMap.set(frame.message, { address: frame.address, signals: new Map() });
      const entry = msgMap.get(frame.message)!;

      for (const [sigName, sigData] of Object.entries(frame.signals)) {
        if (sigName.toLowerCase().includes('key_id')) continue;
        if (entry.signals.has(sigName) || !sigData?.all_states) continue;
        const allStates: Record<number, string> = {};
        Object.entries(sigData.all_states).forEach(([k, v]) => { allStates[Number(k)] = String(v); });
        if (Object.keys(allStates).length > 0) entry.signals.set(sigName, allStates);
      }
    }

    this.messageGroups = [];
    let globalPalIdx   = 0;

    for (const [msgName, msgData] of msgMap) {
      const signalsObj: Record<string, any> = {};
      msgData.signals.forEach((allStates, name) => { signalsObj[name] = { all_states: allStates }; });
      const cards = this.buildCardsForMessage(msgName, msgData.address, signalsObj);
      globalPalIdx += msgData.signals.size;
      this.messageGroups.push({ messageName: msgName, address: msgData.address, visible: true, cards });
    }
  }

  private buildCardsForMessage(
    msgName: string, address: string, signals: Record<string, any>
  ): ChartCard[] {
    const cards: ChartCard[] = [];
    const sigEntries: { name: string; allStates: Record<number, string> }[] = [];

    for (const [sigName, sigData] of Object.entries(signals)) {
      if (sigName.toLowerCase().includes('key_id')) continue;
      if (!sigData?.all_states) continue;
      const allStates: Record<number, string> = {};
      Object.entries(sigData.all_states).forEach(([k, v]) => { allStates[Number(k)] = String(v); });
      if (Object.keys(allStates).length > 0) sigEntries.push({ name: sigName, allStates });
    }

    if (this.chartMode === 'grouped') {
      const groups = new Map<string, typeof sigEntries>();
      sigEntries.forEach(s => {
        const k = this.stateKey(s.allStates);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(s);
      });
      let palIdx = 0;
      groups.forEach(sigsInGroup => {
        const firstStates = sigsInGroup[0].allStates;
        const defVals     = Object.keys(firstStates).map(Number).sort((a, b) => a - b);
        const vm: Record<number, string> = {};
        defVals.forEach(v => { vm[v] = firstStates[v]; });
        const sigDefs: SignalDef[] = sigsInGroup.map((s, i) => ({
          signalName: s.name, color: this.PAL[(palIdx + i) % this.PAL.length], allStates: s.allStates
        }));
        palIdx += sigsInGroup.length;
        const title = sigDefs.length === 1 ? sigDefs[0].signalName : Object.values(firstStates).join(' / ');
        cards.push({ cardId: this.uniqueCardId(msgName, cards.length), title, signals: sigDefs, defVals, vm });
      });
    } else {
      sigEntries.forEach((s, i) => {
        const defVals = Object.keys(s.allStates).map(Number).sort((a, b) => a - b);
        const vm: Record<number, string> = {};
        defVals.forEach(v => { vm[v] = s.allStates[v]; });
        cards.push({
          cardId: this.uniqueCardId(msgName, i),
          title:  s.name,
          signals: [{ signalName: s.name, color: this.PAL[i % this.PAL.length], allStates: s.allStates }],
          defVals, vm
        });
      });
    }
    return cards;
  }

  private uniqueCardId(msgName: string, idx: number): string {
    return `card_${msgName}_${idx}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 80);
  }

  // ─── Render charts (batch / after stream complete) ────────────────────────

  renderAllCharts(): void {
    this.destroyAllCharts();
    for (const group of this.messageGroups) {
      if (!this.isMsgGroupVisible(group)) continue;
      for (const card of group.cards) {
        const canvas = document.getElementById(card.cardId) as HTMLCanvasElement | null;
        if (canvas) card.chart = this.buildChart(canvas, card, group.messageName, false);
      }
    }
    this.chartsRendered = true;
    this.cdr.detectChanges();
  }

  toggleGroupVisibility(group: MessageGroup): void {
    group.visible = !group.visible;
    if (this.activeView === 'charts') setTimeout(() => this.renderAllCharts(), 50);
  }

  // ─── Expand overlay ───────────────────────────────────────────────────────

  expandCard(card: ChartCard, msgName: string, event: Event): void {
    event.stopPropagation();
    this.expandedCard        = card;
    this.expandedCardMsgName = msgName;
    this.cdr.detectChanges();
    setTimeout(() => {
      const cv = document.getElementById(card.cardId + '-exp') as HTMLCanvasElement | null;
      if (cv) this.expandedChartInst = this.buildChart(cv, card, msgName, true);
    }, 80);
  }

  closeExpanded(): void {
    this.expandedChartInst?.destroy();
    this.expandedChartInst = undefined;
    this.expandedCard      = null;
    this.expandedCardMsgName = '';
  }

  resetZoom(): void { (this.expandedChartInst as any)?.resetZoom?.(); }

  onOverlayClick(e: Event): void {
    if ((e.target as HTMLElement).classList.contains('chart-expand-overlay'))
      this.closeExpanded();
  }

  // ─── Chart factory ────────────────────────────────────────────────────────

  private buildEmptyChart(canvas: HTMLCanvasElement, card: ChartCard, msgName: string): Chart {
    const base         = this.logStartTs;
    const longestLabel = Object.values(card.vm).reduce((a, b) => b.length > a.length ? b : a, '');
    const yAxisWidth   = Math.max(72, longestLabel.length * 6.5 + 12);

    return new Chart(canvas, {
      type: 'line',
      data: {
        datasets: card.signals.map(sigDef => ({
          label: sigDef.signalName, data: [] as any[],
          borderColor: sigDef.color, backgroundColor: sigDef.color + '10',
          borderWidth: 2, stepped: 'before' as any,
          pointBackgroundColor: [] as any, pointBorderColor: [] as any,
          pointRadius: [] as any, pointHoverRadius: 4, fill: false, tension: 0
        } as any))
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        layout: { padding: { right: 8, top: 4, bottom: 0, left: 0 } },
        plugins: {
          legend: { display: false },
          zoom: {
            pan:  { enabled: true, mode: 'x' as const },
            zoom: { wheel: { enabled: true, speed: 0.1, modifierKey: 'ctrl' as const }, pinch: { enabled: true }, mode: 'x' as const },
          },
          tooltip: {
            backgroundColor: '#0d1117', borderColor: 'rgba(176,255,68,0.35)', borderWidth: 1,
            titleColor: '#8a9ab0', bodyColor: '#ffffff', padding: 10,
            callbacks: {
              title: (items: any[]) => {
                const ds = card.signals[items[0].datasetIndex];
                const p  = (items[0].raw as any);
                if (!p) return '';
                return `+${(p.x - base).toFixed(3)}s`;
              },
              label: (ctx: any) => {
                const p = ctx.raw as any;
                if (!p) return '';
                return ` ${card.signals[ctx.datasetIndex].signalName}: ${card.vm[p.y] ?? p.y}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            ticks: { font: { size: 8 }, color: 'rgba(138,154,176,0.7)', maxRotation: 90, minRotation: 90, maxTicksLimit: 12, callback: (v: any) => `+${(Number(v) - base).toFixed(1)}s` },
            grid: { color: 'rgba(255,255,255,0.04)' }
          },
          y: {
            min: card.defVals.length ? card.defVals[0] - 0.5 : -0.5,
            max: card.defVals.length ? card.defVals[card.defVals.length - 1] + 0.5 : 1.5,
            afterBuildTicks: (s: any) => { s.ticks = card.defVals.map(v => ({ value: v })); },
            afterFit: (s: any) => { s.width = yAxisWidth; },
            ticks: { font: { size: 10 }, color: 'rgba(138,154,176,0.9)', callback: (v: any) => card.vm[Number(v)] ?? String(v) },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  }

  private buildChart(canvas: HTMLCanvasElement, card: ChartCard, msgName: string, expanded: boolean): Chart {
    const allTs  = [...new Set(this.allFrames.map(f => f.timestamp))].sort((a, b) => a - b);
    const minTs  = allTs[0]  ?? 0;
    const maxTs  = allTs[allTs.length - 1] ?? 1;
    const pad    = (maxTs - minTs) * 0.015 || 0.5;
    const base   = this.logStartTs;

    const msgFrames  = this.allFrames.filter(f => f.message === msgName);
    const msgFrameTs = new Set(msgFrames.map(f => f.timestamp));

    const inlineTicks = (() => {
      if (allTs.length <= 12) return allTs;
      const step = Math.ceil(allTs.length / 12);
      return allTs.filter((_, i) => i % step === 0 || i === allTs.length - 1);
    })();

    const longestLabel = Object.values(card.vm).reduce((a, b) => b.length > a.length ? b : a, '');
    const yAxisWidth   = Math.max(72, longestLabel.length * 6.5 + 12);

    const zoomOpts = {
      zoom:   { wheel: { enabled: true, speed: 0.1, modifierKey: 'ctrl' as const }, pinch: { enabled: true }, mode: 'x' as const },
      pan:    { enabled: true, mode: 'x' as const },
      limits: { x: { min: minTs - pad, max: maxTs + pad } }
    };

    const datasets = card.signals.map(sigDef => {
      const validPts: { x: number; y: number; lbl: string; n: number }[] = [];
      for (const frame of msgFrames) {
        const sd = frame.signals[sigDef.signalName];
        if (sd && sd.is_valid !== false) {
          validPts.push({ x: frame.timestamp, y: Number(sd.raw_value ?? 0), lbl: String(sd.label ?? ''), n: frame.id + 1 });
        }
      }
      const chartData = validPts.map(p => ({ x: p.x, y: p.y }));
      const pR = validPts.map(() => 2);
      const pC = validPts.map(() => sigDef.color);
      if (chartData.length && chartData[chartData.length - 1].x < maxTs) {
        chartData.push({ x: maxTs + pad, y: chartData[chartData.length - 1].y });
        pR.push(0); pC.push('transparent');
      }
      return { sigDef, validPts, chartData, pR, pC };
    });

    return new Chart(canvas, {
      type: 'line',
      data: {
        datasets: datasets.map(d => ({
          label: d.sigDef.signalName, data: d.chartData,
          borderColor: d.sigDef.color, backgroundColor: d.sigDef.color + '10',
          borderWidth: 2, stepped: 'before' as any,
          pointBackgroundColor: d.pC as any, pointBorderColor: d.pC as any,
          pointRadius: d.pR as any, pointHoverRadius: 4, fill: false, tension: 0
        } as any))
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        layout: { padding: { right: 8, top: 4, bottom: 0, left: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item: any) => item.dataIndex < datasets[item.datasetIndex].validPts.length,
            backgroundColor: '#0d1117', borderColor: 'rgba(176,255,68,0.35)', borderWidth: 1,
            titleColor: '#8a9ab0', bodyColor: '#ffffff', padding: 10,
            callbacks: {
              title: (items: any[]) => {
                const ds = datasets[items[0].datasetIndex]; const p = ds.validPts[items[0].dataIndex];
                if (!p) return ''; return `frame #${p.n}  |  +${(p.x - base).toFixed(3)}s  |  ts: ${p.x.toFixed(6)}`;
              },
              label: (ctx: any) => {
                const ds = datasets[ctx.datasetIndex]; const p = ds.validPts[ctx.dataIndex];
                if (!p) return ''; return ` ${ds.sigDef.signalName}: ${p.lbl}  (raw: ${p.y})`;
              }
            }
          },
          zoom: zoomOpts as any
        },
        scales: {
          x: {
            type: 'linear',
            ticks: { font: { size: expanded ? 10 : 8 }, color: 'rgba(138,154,176,0.7)', maxRotation: 90, minRotation: 90, maxTicksLimit: expanded ? 20 : 12, callback: (v: any) => `+${(Number(v) - base).toFixed(expanded ? 2 : 1)}s` },
            grid: { color: 'rgba(255,255,255,0.04)' }
          },
          y: {
            min: card.defVals.length ? card.defVals[0] - 0.5 : -0.5,
            max: card.defVals.length ? card.defVals[card.defVals.length - 1] + 0.5 : 1.5,
            afterBuildTicks: (s: any) => { s.ticks = card.defVals.map(v => ({ value: v })); },
            afterFit: (s: any) => { s.width = yAxisWidth; },
            ticks: { font: { size: 10 }, color: 'rgba(138,154,176,0.9)', callback: (v: any) => card.vm[Number(v)] ?? String(v) },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  }

  private destroyAllCharts(): void {
    for (const group of this.messageGroups) {
      for (const card of group.cards) { card.chart?.destroy(); card.chart = undefined; }
    }
    this.expandedChartInst?.destroy();
    this.expandedChartInst = undefined;
    this.chartsRendered    = false;
  }

  // ─── Filters ──────────────────────────────────────────────────────────────

  get uniqueAddresses(): string[] { return [...new Set(this.allFrames.map(f => f.address))].sort(); }
  get uniqueBuses():     string[] { return [...new Set(this.allFrames.map(f => f.bus))].sort(); }

  private frameMatchesFilters(f: ParsedFrame): boolean {
    const addrOk = !this.filterAddress || f.address === this.filterAddress;
    const busOk  = !this.filterBus     || f.bus     === this.filterBus;
    return addrOk && busOk;
  }

  applyFilters(): void {
    this.filteredFrames = this.allFrames.filter(f => this.frameMatchesFilters(f));
  }

  clearFilters(): void {
    this.filterAddress = '';
    this.filterBus     = '';
    this.msgTree.forEach(n => n.signals.forEach(s => s.checked = true));
    this.filteredFrames = [...this.allFrames];
  }

  // ─── Message/Signal tree ─────────────────────────────────────────────────

  private updateMsgTree(frame: ParsedFrame): void {
    let node = this.msgTree.find(n => n.messageName === frame.message);
    if (!node) {
      node = { messageName: frame.message, address: frame.address, expanded: false, signals: [] };
      this.msgTree = [...this.msgTree, node];
    }
    let changed = false;
    for (const sigName of Object.keys(frame.signals)) {
      if (!node.signals.find(s => s.name === sigName)) {
        node.signals = [...node.signals, { name: sigName, checked: true }];
        changed = true;
      }
    }
    if (changed) this.msgTree = [...this.msgTree];
  }

  toggleMsgExpand(node: MsgTreeNode): void {
    node.expanded = !node.expanded;
  }

  onMsgCheckChange(node: MsgTreeNode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    node.signals.forEach(s => s.checked = checked);
    if (this.activeView === 'charts') setTimeout(() => this.renderAllCharts(), 50);
    this.cdr.detectChanges();
  }

  onSignalCheckChange(node: MsgTreeNode): void {
    if (this.activeView === 'charts') setTimeout(() => this.renderAllCharts(), 50);
    this.cdr.detectChanges();
  }

  isMsgChecked(node: MsgTreeNode): boolean {
    return node.signals.length > 0 && node.signals.every(s => s.checked);
  }

  isMsgIndeterminate(node: MsgTreeNode): boolean {
    const c = node.signals.filter(s => s.checked).length;
    return c > 0 && c < node.signals.length;
  }

  isSignalVisible(messageName: string, signalName: string): boolean {
    const node = this.msgTree.find(n => n.messageName === messageName);
    if (!node) return true;
    const sig = node.signals.find(s => s.name === signalName);
    return sig ? sig.checked : true;
  }

  isCardVisible(messageName: string, card: ChartCard): boolean {
    const node = this.msgTree.find(n => n.messageName === messageName);
    if (!node) return true;
    return card.signals.some(sd => {
      const sig = node.signals.find(s => s.name === sd.signalName);
      return sig ? sig.checked : true;
    });
  }

  isMsgGroupVisible(group: MessageGroup): boolean {
    const node = this.msgTree.find(n => n.messageName === group.messageName);
    if (!node) return true;
    return node.signals.some(s => s.checked);
  }

  allSignalsChecked(): boolean {
    return this.msgTree.every(n => n.signals.every(s => s.checked));
  }

  // ─── Export / clear ───────────────────────────────────────────────────────

  exportResults(): void {
    const blob = new Blob([JSON.stringify(this.allFrames, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'decoded_frames.json'; a.click();
    URL.revokeObjectURL(url);
  }

  clearAnalysis(): void {
    this.dashState$.clear();
    this.destroyAllCharts();
    this.allFrames           = [];
    this.filteredFrames      = [];
    this.showResults         = false;
    this.logFile             = null;
    this.filterAddress       = '';
    this.filterBus           = '';
    this.msgTree             = [];
    this.analyzeError        = '';
    this.messageGroups       = [];
    this.activeView          = 'table';
    this.streamingFrameCount = 0;
    this.streamingDone       = false;
    this.errorReport         = null;
    this.frontendErrors      = [];
    this.xmlFilesUsed        = [];
  }

  // ─── Auto-scroll ──────────────────────────────────────────────────────────

  onTableScroll(): void {
    const el = this.framesWrap?.nativeElement;
    if (!el) return;
    this.autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
  }

  resumeAutoScroll(): void {
    this.autoScroll = true;
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    const el = this.framesWrap?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  formatTimestamp(ts: number): string { return Number.isFinite(ts) ? ts.toFixed(6) : '-'; }
  formatRelative(ts: number):  string { return `+${(ts - this.logStartTs).toFixed(3)}s`; }

  busClass(bus: string): string {
    const b = (bus || '').toLowerCase();
    if (b.includes('car')) return 'bus-car';
    if (b.includes('key')) return 'bus-key';
    return 'bus-generic';
  }

  msgColor(bus: string): string {
    const b = (bus || '').toLowerCase();
    if (b.includes('car')) return 'msg-car';
    if (b.includes('key')) return 'msg-key';
    return 'msg-generic';
  }

  private parseSignalsFromRaw(signals: any): ParsedSignalEntry[] {
    if (!signals || typeof signals !== 'object') return [];
    try {
      return Object.entries(signals).map(([name, value]: [string, any]) => ({
        name,
        value:   String(value?.label     ?? value?.raw_value ?? '-'),
        rawVal:  String(value?.raw_value ?? '-'),
        isValid: value?.is_valid !== false
      }));
    } catch { return []; }
  }

  // ─── Unity 3D panel ──────────────────────────────────────────────────────────

  private pollUnityStatus(): void {
    this.http.get<{ connected: boolean }>(`${API_BASE_URL}/api/unity/status`).subscribe({
      next:  r => { this.unityConnected = r.connected; this.cdr.detectChanges(); },
      error: () => { this.unityConnected = false;      this.cdr.detectChanges(); }
    });
  }

  setUnityLive(): void {
    this.unityMode          = 'live';
    this.liveSendingToUnity = true;
    this.replayDone         = false;
    this.http.post(`${API_BASE_URL}/api/unity/mode`, { mode: 'live' }).subscribe();
  }

  async sendUnityReplay(): Promise<void> {
    if (!this.allFrames.length || this.replayInProgress) return;
    this.replayInProgress   = true;
    this.replayAbort        = false;
    this.replayDone         = false;
    this.replayCurrentFrame = 0;
    this.replayTotal        = this.allFrames.length;
    this.unityMode          = 'replay';
    this.liveSendingToUnity = false;
    this.cdr.detectChanges();

    const delayMs = Math.round(1000 / this.replaySpeed);

    for (let i = 0; i < this.allFrames.length; i++) {
      if (this.replayAbort) break;
      this.replayCurrentFrame = i + 1;
      this.cdr.detectChanges();

      try {
        await this.http.post(`${API_BASE_URL}/api/unity/frame`, this.allFrames[i])
          .toPromise();
      } catch { /* continue on error */ }

      if (delayMs > 0 && i < this.allFrames.length - 1) {
        await new Promise<void>(r => setTimeout(r, delayMs));
      }
    }

    this.replayInProgress = false;
    if (!this.replayAbort) {
      this.replayDone = true;
    } else {
      this.unityMode = null;
    }
    this.cdr.detectChanges();
  }

  stopReplay(): void {
    this.replayAbort      = true;
    this.replayInProgress = false;
    this.cdr.detectChanges();
  }
}