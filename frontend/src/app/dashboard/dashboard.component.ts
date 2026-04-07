import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  Component, OnDestroy, OnInit, inject, NgZone,
  ChangeDetectorRef, HostListener
} from '@angular/core';
import { Router } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';
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

// One chart card = one Chart.js instance
// In grouped mode: may contain multiple signals (same states → same card)
// In separate mode: always exactly one signal per card
interface ChartCard {
  cardId: string;
  title: string;           // signal name if single; state labels if grouped
  signals: SignalDef[];
  defVals: number[];       // sorted Y-axis tick values
  vm: Record<number, string>; // raw value → label
  chart?: Chart;
}

interface MessageGroup {
  messageName: string;
  address: string;
  visible: boolean;
  cards: ChartCard[];
}

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly http   = inject(HttpClient);
  private readonly auth   = inject(AuthService);
  private readonly router = inject(Router);
  private readonly zone   = inject(NgZone);
  private readonly cdr    = inject(ChangeDetectorRef);

  username    = '';
  sidebarOpen = false;

  // Upload
  logFile: File | null = null;
  xmlFiles: File[]     = [];
  isDragOverLog = false;
  isDragOverXml = false;
  analyzing     = false;
  analyzeError  = '';

  // View
  activeView: 'table' | 'charts' = 'table';

  // Chart display mode
  chartMode: 'grouped' | 'separate' = 'grouped';

  // Results
  showResults    = false;
  allFrames: ParsedFrame[]      = [];
  filteredFrames: ParsedFrame[] = [];

  // Filters
  filterAddress = '';
  filterBus     = '';
  filterSignal  = '';

  // Charts
  messageGroups: MessageGroup[] = [];
  chartsRendered = false;

  // Expand overlay
  expandedCard: ChartCard | null = null;
  expandedCardMsgName = '';
  private expandedChartInst?: Chart;

  // Timestamp baseline
  private logStartTs = 0;

  // Color palette
  private readonly PAL = [
    '#b0ff44', '#60cfff', '#ffb347', '#ff6b9d',
    '#c77dff', '#4cc9f0', '#f72585', '#7bed9f',
    '#ffd700', '#ff4757', '#2ed573', '#1e90ff'
  ];

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.username = this.auth.getCurrentUser() ?? 'user';
  }

  ngOnDestroy(): void {
    this.destroyAllCharts();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.closeExpanded(); }

  // ─── Navigation ──────────────────────────────────────────────────────────

  toggleSidebar(): void { this.sidebarOpen = !this.sidebarOpen; }
  logout():        void { this.auth.logout(); this.router.navigate(['/login']); }
  goToUsers():     void { this.router.navigate(['/users']); }

  // ─── Upload handlers ─────────────────────────────────────────────────────

  onLogFileSelect(e: Event): void {
    this.logFile = (e.target as HTMLInputElement).files?.[0] ?? null;
  }
  onXmlFilesSelect(e: Event): void {
    const i = e.target as HTMLInputElement;
    this.xmlFiles = i.files ? Array.from(i.files) : [];
  }

  onDragOverLog(e: DragEvent):  void { e.preventDefault(); this.isDragOverLog = true; }
  onDragLeaveLog(e: DragEvent): void { e.preventDefault(); this.isDragOverLog = false; }
  onDropLog(e: DragEvent): void {
    e.preventDefault(); this.isDragOverLog = false;
    const f = e.dataTransfer?.files?.[0] ?? null;
    if (f) this.logFile = f;
  }

  onDragOverXml(e: DragEvent):  void { e.preventDefault(); this.isDragOverXml = true; }
  onDragLeaveXml(e: DragEvent): void { e.preventDefault(); this.isDragOverXml = false; }
  onDropXml(e: DragEvent): void {
    e.preventDefault(); this.isDragOverXml = false;
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) this.xmlFiles = files;
  }

  canAnalyze(): boolean {
    return !!this.logFile && this.xmlFiles.length > 0 && !this.analyzing;
  }

  // ─── Analyze ─────────────────────────────────────────────────────────────

  analyze(): void {
    if (!this.canAnalyze()) return;
    this.analyzing    = true;
    this.analyzeError = '';
    this.showResults  = false;
    this.destroyAllCharts();

    const fd = new FormData();
    fd.append('logFile', this.logFile!);
    this.xmlFiles.forEach(f => fd.append('xmlFiles', f));

    this.http.post<any[]>(`${API_BASE_URL}/api/analyze`, fd).subscribe({
      next: (response) => {
        this.zone.run(() => {
          const frames = response ?? [];
          this.allFrames = frames.map((f: any, i: number) => ({
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
          }));
          this.logStartTs     = this.allFrames.length
            ? Math.min(...this.allFrames.map(f => f.timestamp))
            : 0;
          this.filteredFrames = [...this.allFrames];
          this.buildMessageGroups();
          this.showResults = true;
          this.analyzing   = false;
          this.activeView  = 'table';
          this.cdr.detectChanges();
        });
      },
      error: (err: HttpErrorResponse) => {
        this.zone.run(() => {
          this.analyzeError = err?.error?.message ?? 'Analysis failed. Please try again.';
          this.analyzing    = false;
          this.cdr.detectChanges();
        });
      }
    });
  }

  // ─── View ────────────────────────────────────────────────────────────────

  switchView(view: 'table' | 'charts'): void {
    this.activeView = view;
    if (view === 'charts') setTimeout(() => this.renderAllCharts(), 80);
  }

  // ─── Chart mode toggle ────────────────────────────────────────────────────

  setChartMode(mode: 'grouped' | 'separate'): void {
    if (this.chartMode === mode) return;
    this.chartMode = mode;
    this.buildMessageGroups();
    if (this.activeView === 'charts') {
      setTimeout(() => this.renderAllCharts(), 80);
    }
  }

  // ─── State key — compares BOTH raw numeric values AND label strings ───────
  // {0:"off",1:"on"}      → "0=off|1=on"
  // {0:"Closed",1:"opened"} → "0=Closed|1=opened"
  // These two are NOT equal, so they will NOT be grouped together.

  private stateKey(v: Record<number, string>): string {
    return Object.keys(v)
      .map(Number)
      .sort((a, b) => a - b)
      .map(k => `${k}=${v[k]}`)
      .join('|');
  }

  // ─── Build message groups & chart card definitions ────────────────────────

  buildMessageGroups(): void {
    // Step 1: collect all unique signals per message from all frames
    const msgMap = new Map<string, {
      address: string;
      signals: Map<string, Record<number, string>>;
    }>();

    for (const frame of this.allFrames) {
      if (!msgMap.has(frame.message)) {
        msgMap.set(frame.message, { address: frame.address, signals: new Map() });
      }
      const entry = msgMap.get(frame.message)!;

      for (const [sigName, sigData] of Object.entries(frame.signals)) {
        if (sigName.toLowerCase().includes('key_id')) continue;
        if (entry.signals.has(sigName)) continue;
        if (!sigData?.all_states) continue;

        const allStates: Record<number, string> = {};
        Object.entries(sigData.all_states).forEach(([k, v]) => {
          allStates[Number(k)] = String(v);
        });
        if (Object.keys(allStates).length > 0) {
          entry.signals.set(sigName, allStates);
        }
      }
    }

    // Step 2: build MessageGroup array with ChartCard definitions
    this.messageGroups = [];
    let globalPalIdx   = 0;

    for (const [msgName, msgData] of msgMap) {
      const cards: ChartCard[] = [];

      if (this.chartMode === 'grouped') {
        // Group signals that have IDENTICAL state keys
        const groups = new Map<string, Array<{ name: string; allStates: Record<number, string> }>>();

        for (const [sigName, allStates] of msgData.signals) {
          const key = this.stateKey(allStates);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push({ name: sigName, allStates });
        }

        for (const sigsInGroup of groups.values()) {
          const firstStates = sigsInGroup[0].allStates;
          const defVals     = Object.keys(firstStates).map(Number).sort((a, b) => a - b);
          const vm: Record<number, string> = {};
          defVals.forEach(v => { vm[v] = firstStates[v]; });

          const sigDefs: SignalDef[] = sigsInGroup.map((s, i) => ({
            signalName: s.name,
            color:      this.PAL[(globalPalIdx + i) % this.PAL.length],
            allStates:  s.allStates
          }));
          globalPalIdx += sigsInGroup.length;

          const title = sigDefs.length === 1
            ? sigDefs[0].signalName
            : Object.values(firstStates).join(' / ');

          cards.push({
            cardId:  this.uniqueCardId(msgName, cards.length),
            title,
            signals: sigDefs,
            defVals,
            vm
          });
        }

      } else {
        // Separate: one card per signal
        let localIdx = 0;
        for (const [sigName, allStates] of msgData.signals) {
          const defVals = Object.keys(allStates).map(Number).sort((a, b) => a - b);
          const vm: Record<number, string> = {};
          defVals.forEach(v => { vm[v] = allStates[v]; });

          cards.push({
            cardId:  this.uniqueCardId(msgName, localIdx),
            title:   sigName,
            signals: [{
              signalName: sigName,
              color:      this.PAL[(globalPalIdx + localIdx) % this.PAL.length],
              allStates
            }],
            defVals,
            vm
          });
          localIdx++;
        }
        globalPalIdx += msgData.signals.size;
      }

      this.messageGroups.push({
        messageName: msgName,
        address:     msgData.address,
        visible:     true,
        cards
      });
    }
  }

  private uniqueCardId(msgName: string, idx: number): string {
    return `card_${msgName}_${idx}`
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 80);
  }

  // ─── Render all visible charts ────────────────────────────────────────────

  renderAllCharts(): void {
    this.destroyAllCharts();
    for (const group of this.messageGroups) {
      if (!group.visible) continue;
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

  // ─── Core chart factory ───────────────────────────────────────────────────

  private buildChart(
    canvas: HTMLCanvasElement,
    card: ChartCard,
    msgName: string,
    expanded: boolean
  ): Chart {
    const allTs  = [...new Set(this.allFrames.map(f => f.timestamp))].sort((a, b) => a - b);
    const minTs  = allTs[0]  ?? 0;
    const maxTs  = allTs[allTs.length - 1] ?? 1;
    const pad    = (maxTs - minTs) * 0.015 || 0.5;
    const base   = this.logStartTs;

    const msgFrames  = this.allFrames.filter(f => f.message === msgName);
    const msgFrameTs = new Set(msgFrames.map(f => f.timestamp));

    // Inline: evenly spaced max 12 ticks. Expanded: all timestamps.
    const inlineTicks = (() => {
      if (allTs.length <= 12) return allTs;
      const step = Math.ceil(allTs.length / 12);
      return allTs.filter((_, i) => i % step === 0 || i === allTs.length - 1);
    })();

    // Dynamic Y-axis left padding based on longest label
    const longestLabel = Object.values(card.vm)
      .reduce((a, b) => b.length > a.length ? b : a, '');
    const yAxisWidth = Math.max(72, longestLabel.length * 6.5 + 12);

    const zoomOpts = expanded ? {
      zoom:   { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' as const },
      pan:    { enabled: true, mode: 'x' as const },
      limits: { x: { min: minTs - pad, max: maxTs + pad } }
    } : {};

    // Build one dataset per signal in this card
    const datasets = card.signals.map(sigDef => {
      // Valid points only — hold-previous for undefined/invalid values
      const validPts: { x: number; y: number; lbl: string; n: number }[] = [];
      for (const frame of msgFrames) {
        const sd = frame.signals[sigDef.signalName];
        if (sd && sd.is_valid !== false) {
          validPts.push({
            x:   frame.timestamp,
            y:   Number(sd.raw_value ?? 0),
            lbl: String(sd.label ?? ''),
            n:   frame.id + 1
          });
        }
      }

      // Extend step line to right edge of log
      const chartData: { x: number; y: number }[] = validPts.map(p => ({ x: p.x, y: p.y }));
      const pR: number[] = validPts.map(() => 4);
      const pC: string[] = validPts.map(() => sigDef.color);
      if (chartData.length && chartData[chartData.length - 1].x < maxTs) {
        chartData.push({ x: maxTs + pad, y: chartData[chartData.length - 1].y });
        pR.push(0);
        pC.push('transparent');
      }

      return { sigDef, validPts, chartData, pR, pC };
    });

    return new Chart(canvas, {
      type: 'line',
      data: {
        datasets: datasets.map(d => ({
          label:                d.sigDef.signalName,
          data:                 d.chartData,
          borderColor:          d.sigDef.color,
          backgroundColor:      d.sigDef.color + '10',
          borderWidth:          2,
          stepped:              'before' as any,
          pointBackgroundColor: d.pC as any,
          pointBorderColor:     d.pC as any,
          pointRadius:          d.pR as any,
          pointHoverRadius:     6,
          fill:                 false,
          tension:              0
        } as any))
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        parsing:             false,
        layout: { padding: { right: 8, top: 4, bottom: 0, left: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item: any) =>
              item.dataIndex < datasets[item.datasetIndex].validPts.length,
            backgroundColor: '#0d1117',
            borderColor:     'rgba(176,255,68,0.35)',
            borderWidth:     1,
            titleColor:      '#8a9ab0',
            bodyColor:       '#ffffff',
            padding:         10,
            callbacks: {
              title: (items: any[]) => {
                const ds = datasets[items[0].datasetIndex];
                const p  = ds.validPts[items[0].dataIndex];
                if (!p) return '';
                return `frame #${p.n}  |  +${(p.x - base).toFixed(3)}s  |  ts: ${p.x.toFixed(6)}`;
              },
              label: (ctx: any) => {
                const ds = datasets[ctx.datasetIndex];
                const p  = ds.validPts[ctx.dataIndex];
                if (!p) return '';
                return ` ${ds.sigDef.signalName}: ${p.lbl}  (raw: ${p.y})`;
              }
            }
          },
          zoom: zoomOpts as any
        },
        scales: {
          x: {
            type:  'linear',
            min:   minTs - pad,
            max:   maxTs + pad,
            // Inline: force evenly spaced ticks (max 12) so all charts share same rhythm
            // Expanded: let Chart.js auto-calculate ticks based on zoom level — readable
            ...(expanded ? {} : {
              afterBuildTicks: (scale: any) => {
                scale.ticks = inlineTicks.map((ts: number) => ({ value: ts }));
              }
            }),
            ticks: {
              font:          { size: expanded ? 10 : 8 },
              color:         'rgba(138,154,176,0.75)',
              maxRotation:   90,
              minRotation:   90,
              maxTicksLimit: expanded ? 20 : 12,
              callback:      (v: any) => `+${(Number(v) - base).toFixed(expanded ? 2 : 1)}s`
            },
            grid: {
              color: (ctx: any) =>
                msgFrameTs.has(ctx.tick?.value)
                  ? 'rgba(176,255,68,0.2)'
                  : 'rgba(255,255,255,0.04)',
              lineWidth: (ctx: any) =>
                msgFrameTs.has(ctx.tick?.value) ? 1.2 : 0.5
            }
          },
          y: {
            min: card.defVals.length ? card.defVals[0]                      - 0.5 : -0.5,
            max: card.defVals.length ? card.defVals[card.defVals.length - 1] + 0.5 :  1.5,
            afterBuildTicks: (scale: any) => {
              scale.ticks = card.defVals.map((v: number) => ({ value: v }));
            },
            afterFit: (scale: any) => { scale.width = yAxisWidth; },
            ticks: {
              font:     { size: 10 },
              color:    'rgba(138,154,176,0.9)',
              callback: (v: any) => card.vm[Number(v)] ?? String(v)
            },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  }

  private destroyAllCharts(): void {
    for (const group of this.messageGroups) {
      for (const card of group.cards) {
        card.chart?.destroy();
        card.chart = undefined;
      }
    }
    this.expandedChartInst?.destroy();
    this.expandedChartInst = undefined;
    this.chartsRendered    = false;
  }

  // ─── Filters ──────────────────────────────────────────────────────────────

  get uniqueAddresses(): string[] {
    return [...new Set(this.allFrames.map(f => f.address))].sort();
  }
  get uniqueBuses(): string[] {
    return [...new Set(this.allFrames.map(f => f.bus))].sort();
  }

  applyFilters(): void {
    this.filteredFrames = this.allFrames.filter(f => {
      const addrOk = !this.filterAddress || f.address === this.filterAddress;
      const busOk  = !this.filterBus     || f.bus     === this.filterBus;
      const sigOk  = !this.filterSignal  ||
        f.parsedSignals.some(s =>
          s.name.toLowerCase().includes(this.filterSignal.toLowerCase()) ||
          s.value.toLowerCase().includes(this.filterSignal.toLowerCase())
        );
      return addrOk && busOk && sigOk;
    });
  }

  clearFilters(): void {
    this.filterAddress  = '';
    this.filterBus      = '';
    this.filterSignal   = '';
    this.filteredFrames = [...this.allFrames];
  }

  // ─── Export / clear ───────────────────────────────────────────────────────

  exportResults(): void {
    const blob = new Blob(
      [JSON.stringify(this.allFrames, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = 'decoded_frames.json'; a.click();
    URL.revokeObjectURL(url);
  }

  clearAnalysis(): void {
    this.destroyAllCharts();
    this.allFrames      = [];
    this.filteredFrames = [];
    this.showResults    = false;
    this.logFile        = null;
    this.xmlFiles       = [];
    this.filterAddress  = '';
    this.filterBus      = '';
    this.filterSignal   = '';
    this.analyzeError   = '';
    this.messageGroups  = [];
    this.activeView     = 'table';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  formatTimestamp(ts: number): string {
    return Number.isFinite(ts) ? ts.toFixed(6) : '-';
  }

  formatRelative(ts: number): string {
    return `+${(ts - this.logStartTs).toFixed(3)}s`;
  }

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
}