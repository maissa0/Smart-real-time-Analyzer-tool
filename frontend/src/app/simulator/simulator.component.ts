import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Component, OnDestroy, OnInit, inject, NgZone,
  ChangeDetectorRef, HostListener
} from '@angular/core';
import { Router } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { FormsModule } from '@angular/forms';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { AuthService } from '../services/auth.service';
import { SimulatorStateService } from '../services/simulator-state.service';
import { API_BASE_URL } from '../config/api.config';

Chart.register(...registerables, zoomPlugin);

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SimSignalEntry {
  name: string;
  value: string;
  rawVal: number;
  isValid: boolean;
  allStates: Record<number, string>;
}

interface SimFrame {
  id: number;
  timestamp: number;
  channel: number;
  address: string;
  bus: string;
  message: string;
  direction: string;
  rawData: number[];
  signals: Record<string, any>;
  parsedSignals: SimSignalEntry[];
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

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './simulator.component.html',
  styleUrl: './simulator.component.css',
})
export class SimulatorComponent implements OnInit, OnDestroy {
  private readonly http      = inject(HttpClient);
  private readonly auth      = inject(AuthService);
  private readonly router    = inject(Router);
  private readonly zone      = inject(NgZone);
  private readonly cdr       = inject(ChangeDetectorRef);
  private readonly simState$ = inject(SimulatorStateService);

  username    = '';
  sidebarOpen = false;
  isAdmin     = false;

  // Sim state
  simState: 'idle' | 'running' | 'paused' = 'idle';
  frameCount = 0;

  // Speed
  speedMultiplier = 1.0;
  readonly speedOptions = [
    { label: '0.5x', value: 0.5 },
    { label: '1x',   value: 1.0 },
    { label: '2x',   value: 2.0 },
    { label: '5x',   value: 5.0 },
    { label: '10x',  value: 10.0 },
  ];

  // View
  activeView: 'table' | 'charts' | '3d' = 'table';
  chartMode: 'grouped' | 'separate' = 'grouped';

  // Results
  showResults   = false;
  allFrames: SimFrame[]      = [];
  filteredFrames: SimFrame[] = [];

  // Filters
  filterAddress = '';
  filterBus     = '';

  // Signal tree
  msgTree: MsgTreeNode[] = [];

  // Charts
  messageGroups: MessageGroup[] = [];

  // Expand overlay
  expandedCard: ChartCard | null = null;
  expandedCardMsgName = '';
  private expandedChartInst?: Chart;

  private logStartTs = 0;
  private chartUpdatePending = false;
  private chartUpdateTimer?: any;

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

  private stompClient?: Client;

  private readonly PAL = [
    '#b0ff44','#60cfff','#ffb347','#ff6b9d',
    '#c77dff','#4cc9f0','#f72585','#7bed9f',
    '#ffd700','#ff4757','#2ed573','#1e90ff'
  ];

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.username = this.auth.getCurrentUser() ?? 'user';
    this.isAdmin  = this.auth.isAdmin();
    this.restoreState();
    this.initStomp();
  }

  ngOnDestroy(): void {
    this.saveState();
    this.stompClient?.deactivate();
    this.destroyAllCharts();
    if (this.chartUpdateTimer) clearTimeout(this.chartUpdateTimer);
    if (this._statusInterval) clearInterval(this._statusInterval);
  }

  private saveState(): void {
    this.simState$.snapshot = {
      simState:        this.simState === 'running' ? 'paused' : this.simState,
      frameCount:      this.frameCount,
      showResults:     this.showResults,
      activeView:      this.activeView,
      chartMode:       this.chartMode,
      allFrames:       this.allFrames,
      filteredFrames:  this.filteredFrames,
      msgTree:         this.msgTree,
      messageGroups:   this.messageGroups.map(g => ({
        ...g,
        cards: g.cards.map((c: any) => {
          const { chart, ...rest } = c;
          return rest;
        }),
      })),
      logStartTs:      this.logStartTs,
      filterAddress:   this.filterAddress,
      filterBus:       this.filterBus,
      speedMultiplier: this.speedMultiplier,
    };
  }

  private restoreState(): void {
    const snap = this.simState$.snapshot;
    if (!snap || snap.allFrames.length === 0) return;

    this.simState        = snap.simState;
    this.frameCount      = snap.frameCount;
    this.showResults     = snap.showResults;
    this.activeView      = snap.activeView;
    this.chartMode       = snap.chartMode;
    this.allFrames       = snap.allFrames;
    this.filteredFrames  = snap.filteredFrames;
    this.msgTree         = snap.msgTree;
    this.messageGroups   = snap.messageGroups;
    this.logStartTs      = snap.logStartTs;
    this.filterAddress   = snap.filterAddress;
    this.filterBus       = snap.filterBus;
    this.speedMultiplier = snap.speedMultiplier;

    this.cdr.detectChanges();
    if (this.activeView === 'charts' && this.showResults) {
      setTimeout(() => this.renderAllCharts(), 150);
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.closeExpanded(); }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  toggleSidebar(): void { this.sidebarOpen = !this.sidebarOpen; }
  logout():        void { this.auth.logout(); this.router.navigate(['/login']); }
  goToDashboard(): void { this.router.navigate(['/dashboard']); }
  goToUsers():     void { this.router.navigate(['/users']); }
  goToProfile():   void { this.router.navigate(['/profile']); }

  // ─── STOMP Setup ─────────────────────────────────────────────────────────────

  private initStomp(): void {
    this.stompClient = new Client({
      webSocketFactory: () => new SockJS(`${API_BASE_URL}/ws`),
      reconnectDelay: 3000,
      onConnect: () => {
        console.log('[STOMP] Connected to WebSocket broker');
        this.stompClient!.subscribe('/topic/frames', (msg) => {
          console.log('[STOMP] Frame received from /topic/frames:', msg.body.slice(0, 120));
          try {
            const raw = JSON.parse(msg.body);
            this.zone.run(() => this.onFrameReceived(raw));
          } catch (e) {
            console.error('[STOMP] Failed to parse frame:', e);
          }
        });
      },
      onDisconnect: () => console.warn('[STOMP] Disconnected'),
      onStompError: (frame) => console.error('[STOMP] Error:', frame),
      onWebSocketError: (evt) => console.error('[STOMP] WebSocket error:', evt),
    });
    console.log(`[STOMP] Connecting to ${API_BASE_URL}/ws …`);
    this.stompClient.activate();
  }

  // ─── Simulation controls ────────────────────────────────────────────────────

  startSim(): void {
    if (this.simState === 'idle') {
      this.allFrames     = [];
      this.filteredFrames = [];
      this.msgTree       = [];
      this.messageGroups = [];
      this.frameCount    = 0;
      this.showResults   = true;
      this.activeView    = 'table';
      this.destroyAllCharts();
      this.sendSpeed();
      this.publish('/app/simulate/start', {});
    } else if (this.simState === 'paused') {
      this.publish('/app/simulate/resume', {});
    }
    this.simState = 'running';
  }

  pauseSim(): void {
    if (this.simState !== 'running') return;
    this.publish('/app/simulate/pause', {});
    this.simState = 'paused';
  }

  stopSim(): void {
    this.publish('/app/simulate/stop', {});
    this.simState          = 'idle';
    this.liveSendingToUnity = false;
  }

  resetSim(): void {
    this.publish('/app/simulate/reset', {});
    this.simState           = 'idle';
    this.allFrames          = [];
    this.filteredFrames     = [];
    this.msgTree            = [];
    this.messageGroups      = [];
    this.frameCount         = 0;
    this.showResults        = false;
    this.liveSendingToUnity = false;
    this.simState$.clear();
    this.destroyAllCharts();
    this.cdr.detectChanges();
  }

  onSpeedChange(): void {
    if (this.simState !== 'idle') {
      this.sendSpeed();
    }
  }

  private sendSpeed(): void {
    this.publish('/app/simulate/speed', { multiplier: this.speedMultiplier });
  }

  private publish(destination: string, body: any): void {
    if (this.stompClient?.connected) {
      console.log('[STOMP] Publishing to', destination, body);
      this.stompClient.publish({ destination, body: JSON.stringify(body) });
    } else {
      console.warn('[STOMP] Cannot publish — not connected. destination=', destination);
    }
  }

  // ─── Frame received ──────────────────────────────────────────────────────────

  private onFrameReceived(raw: any): void {
    const frame = this.mapFrame(raw, this.allFrames.length);
    if (this.allFrames.length === 0) this.logStartTs = frame.timestamp;

    this.allFrames.push(frame);
    this.frameCount = this.allFrames.length;
    this.updateMsgTree(frame);

    if (this.frameMatchesFilters(frame)) {
      this.filteredFrames = [...this.filteredFrames, frame];
    }

    this.onFrameUpdateCharts(frame);

    // Forward to Unity in live mode
    if (this.unityMode === 'live' && this.liveSendingToUnity) {
      this.http.post(`${API_BASE_URL}/api/unity/frame`, raw).subscribe();
    }

    this.cdr.detectChanges();
  }

  private mapFrame(f: any, i: number): SimFrame {
    const rawSignals: Record<string, any> = {};
    const parsedSignals: SimSignalEntry[] = [];

    if (Array.isArray(f.parsed_signals)) {
      for (const s of f.parsed_signals) {
        const allStates: Record<number, string> = {};
        if (s.all_states) {
          Object.entries(s.all_states).forEach(([k, v]) => {
            allStates[Number(k)] = String(v);
          });
        }
        rawSignals[s.name] = {
          raw_value:  s.raw_value,
          value:      s.value,
          is_valid:   s.is_valid,
          all_states: allStates,
        };
        parsedSignals.push({
          name:      s.name,
          value:     s.value ?? String(s.raw_value),
          rawVal:    s.raw_value,
          isValid:   s.is_valid !== false,
          allStates,
        });
      }
    }

    return {
      id:           i,
      timestamp:    Number(f.timestamp),
      channel:      Number(f.channel ?? 1),
      address:      String(f.address ?? ''),
      bus:          String(f.bus ?? ''),
      message:      String(f.message ?? ''),
      direction:    String(f.direction ?? 'Rx'),
      rawData:      Array.isArray(f.raw_data) ? f.raw_data : [],
      signals:      rawSignals,
      parsedSignals,
    };
  }

  // ─── Filter helpers ──────────────────────────────────────────────────────────

  get uniqueAddresses(): string[] {
    return [...new Set(this.allFrames.map(f => f.address))].sort();
  }

  get uniqueBuses(): string[] {
    return [...new Set(this.allFrames.map(f => f.bus))].sort();
  }

  frameMatchesFilters(f: SimFrame): boolean {
    if (this.filterAddress && f.address !== this.filterAddress) return false;
    if (this.filterBus     && f.bus     !== this.filterBus)     return false;
    return true;
  }

  applyFilters(): void {
    this.filteredFrames = this.allFrames.filter(f => this.frameMatchesFilters(f));
  }

  clearFilters(): void {
    this.filterAddress = '';
    this.filterBus     = '';
    this.applyFilters();
    this.msgTree.forEach(n => n.signals.forEach(s => s.checked = true));
    this.rerenderVisibleCharts();
  }

  // ─── Message/Signal tree ─────────────────────────────────────────────────────

  private updateMsgTree(frame: SimFrame): void {
    let node = this.msgTree.find(n => n.messageName === frame.message);
    if (!node) {
      node = { messageName: frame.message, address: frame.address, expanded: false, signals: [] };
      this.msgTree = [...this.msgTree, node];
    }
    for (const sig of frame.parsedSignals) {
      if (!node.signals.find(s => s.name === sig.name)) {
        node.signals.push({ name: sig.name, checked: true });
      }
    }
  }

  toggleMsgExpand(node: MsgTreeNode): void { node.expanded = !node.expanded; }

  isMsgChecked(node: MsgTreeNode): boolean {
    return node.signals.length > 0 && node.signals.every(s => s.checked);
  }

  isMsgIndeterminate(node: MsgTreeNode): boolean {
    const c = node.signals.filter(s => s.checked).length;
    return c > 0 && c < node.signals.length;
  }

  onMsgCheckChange(node: MsgTreeNode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    node.signals.forEach(s => s.checked = checked);
    this.rerenderVisibleCharts();
  }

  onSignalCheckChange(_node: MsgTreeNode): void {
    this.rerenderVisibleCharts();
  }

  allSignalsChecked(): boolean {
    return this.msgTree.every(n => n.signals.every(s => s.checked));
  }

  isSignalVisible(messageName: string, signalName: string): boolean {
    const node = this.msgTree.find(n => n.messageName === messageName);
    if (!node) return true;
    const sig = node.signals.find(s => s.name === signalName);
    return sig ? sig.checked : true;
  }

  isCardVisible(messageName: string, card: ChartCard): boolean {
    return card.signals.some(s => this.isSignalVisible(messageName, s.signalName));
  }

  isMsgGroupVisible(group: MessageGroup): boolean {
    return group.cards.some(c => this.isCardVisible(group.messageName, c));
  }

  // ─── Charts ──────────────────────────────────────────────────────────────────

  // ─── trackBy helpers (prevent canvas DOM teardown on array mutations) ────────

  trackByMsgGroup(_i: number, g: MessageGroup): string { return g.messageName; }
  trackByCard(_i: number, c: ChartCard): string { return c.cardId; }

  // ─────────────────────────────────────────────────────────────────────────────

  switchView(view: 'table' | 'charts' | '3d'): void {
    const leaving3d  = this.activeView === '3d' && view !== '3d';
    const entering3d = view === '3d' && this.activeView !== '3d';
    this.activeView = view;
    this.cdr.detectChanges();
    if (entering3d) {
      this.pollUnityStatus();
      this._statusInterval = setInterval(() => this.pollUnityStatus(), 3000);
    }
    if (leaving3d) {
      clearInterval(this._statusInterval);
    }
    if (view === 'charts') setTimeout(() => this.renderAllCharts(), 100);
  }

  setChartMode(mode: 'grouped' | 'separate'): void {
    if (this.chartMode === mode) return;
    this.chartMode = mode;
    this.destroyAllCharts();
    this.buildMessageGroups();
    if (this.activeView === 'charts') {
      this.cdr.detectChanges();
      setTimeout(() => this.renderAllCharts(), 100);
    }
  }

  private stateKey(v: Record<number, string>): string {
    return Object.keys(v).map(Number).sort((a, b) => a - b)
      .map(k => `${k}=${v[k]}`).join('|');
  }

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

    for (const [msgName, msgData] of msgMap) {
      const signalsObj: Record<string, any> = {};
      msgData.signals.forEach((allStates, name) => { signalsObj[name] = { all_states: allStates }; });
      const cards = this.buildCardsForMessage(msgName, msgData.address, signalsObj);
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
      const byStateKey = new Map<string, typeof sigEntries>();
      for (const se of sigEntries) {
        const key = this.stateKey(se.allStates);
        if (!byStateKey.has(key)) byStateKey.set(key, []);
        byStateKey.get(key)!.push(se);
      }
      let palIdx = 0;
      for (const [, group] of byStateKey) {
        const sigDefs: SignalDef[] = group.map(se => ({
          signalName: se.name,
          color:      this.PAL[palIdx++ % this.PAL.length],
          allStates:  se.allStates,
        }));
        const first   = group[0].allStates;
        const defVals = Object.keys(first).map(Number).sort((a, b) => a - b);
        const vm: Record<number, string> = {};
        defVals.forEach(v => vm[v] = first[v]);
        const title   = group.length === 1 ? group[0].name : group.map(g => g.name).join(' / ');
        const cardId  = `sim-${msgName}-${group[0].name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        cards.push({ cardId, title, signals: sigDefs, defVals, vm });
      }
    } else {
      let palIdx = 0;
      for (const se of sigEntries) {
        const sigDef: SignalDef = {
          signalName: se.name,
          color:      this.PAL[palIdx++ % this.PAL.length],
          allStates:  se.allStates,
        };
        const defVals = Object.keys(se.allStates).map(Number).sort((a, b) => a - b);
        const vm: Record<number, string> = {};
        defVals.forEach(v => vm[v] = se.allStates[v]);
        const cardId = `sim-${msgName}-${se.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        cards.push({ cardId, title: se.name, signals: [sigDef], defVals, vm });
      }
    }
    return cards;
  }

  private renderAllCharts(): void {
    this.destroyAllCharts();
    for (const group of this.messageGroups) {
      for (const card of group.cards) {
        const canvas = document.getElementById(card.cardId) as HTMLCanvasElement | null;
        if (!canvas) continue;
        card.chart = this.buildEmptyChart(canvas, card, group.messageName);
        for (const frame of this.allFrames) {
          if (frame.message !== group.messageName) continue;
          this.appendFrameToCard(card, frame, false);
        }
        card.chart.update();
      }
    }
    this.chartsRendered = true;
  }
  private chartsRendered = false;

  private buildEmptyChart(canvas: HTMLCanvasElement, card: ChartCard, msgName: string): Chart {
    const datasets = card.signals.map(sig => ({
      label:              sig.signalName,
      data:               [] as { x: number; y: number }[],
      borderColor:        sig.color,
      backgroundColor:    sig.color + '22',
      stepped:            true as const,
      tension:            0,
      pointRadius:        [] as number[],
      pointBackgroundColor: [] as string[],
      pointHoverRadius:   4,
      borderWidth:        2,
    }));

    return new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        animation:   false,
        responsive:  true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          zoom: {
            pan:  { enabled: true, mode: 'x' },
            zoom: { wheel: { enabled: true, speed: 0.1, modifierKey: 'ctrl' as const }, pinch: { enabled: true }, mode: 'x' },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const ds  = ctx.dataset as any;
                const raw = ctx.parsed.y;
                const sig = card.signals.find(s => s.signalName === ds.label);
                const lbl = raw != null ? (sig?.allStates?.[raw] ?? String(raw)) : '—';
                return `${ds.label}: ${lbl} (${raw})`;
              },
            },
          },
        },
        scales: {
          x: {
            type:   'linear',
            title:  { display: true, text: 'seconds from start', color: '#888' },
            ticks:  { color: '#888', maxTicksLimit: 8 },
            grid:   { color: '#2a2a2a' },
          },
          y: {
            ticks: {
              color:          '#ccc',
              stepSize:       1,
              callback: (val) => {
                const lbl = card.vm[Number(val)];
                return lbl !== undefined ? `${lbl} (${val})` : String(val);
              },
            },
            grid: { color: '#2a2a2a' },
          },
        },
      },
    });
  }

  private onFrameUpdateCharts(frame: SimFrame): void {
    if (frame.message === 'Unknown') return;

    let group = this.messageGroups.find(g => g.messageName === frame.message);

    if (!group) {
      group = {
        messageName: frame.message,
        address:     frame.address,
        visible:     true,
        cards:       this.buildCardsForMessage(frame.message, frame.address, frame.signals),
      };
      this.messageGroups = [...this.messageGroups, group];
      this.cdr.detectChanges();
      // 100ms gives Angular + trackBy time to stamp the new canvas into the DOM
      setTimeout(() => {
        if (this.activeView === 'charts' && !group!.cards.some(c => c.chart)) {
          this.initChartsForGroup(group!);
          this.appendFrameToGroupCharts(group!, frame);
        }
      }, 100);
      return;
    }

    if (this.activeView === 'charts') {
      this.appendFrameToGroupCharts(group, frame);
      this.scheduleChartUpdate();
    }
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

  private appendFrameToGroupCharts(group: MessageGroup, frame: SimFrame): void {
    for (const card of group.cards) {
      if (!card.chart) continue;
      this.appendFrameToCard(card, frame, true);
    }
  }

  private appendFrameToCard(card: ChartCard, frame: SimFrame, withTail: boolean): void {
    card.signals.forEach((sigDef, datasetIdx) => {
      const sd = frame.signals[sigDef.signalName];
      if (!sd || sd.is_valid === false) return;

      const dataset = card.chart!.data.datasets[datasetIdx];
      const data    = dataset.data as { x: number; y: number }[];
      const ds: any = dataset;
      const pR      = ds.pointRadius as number[];
      const pC      = ds.pointBackgroundColor as string[];

      if (withTail && data.length > 0 && (data[data.length - 1] as any)._tail) {
        data.pop(); pR.pop(); pC.pop();
      }

      const relTs = frame.timestamp - this.logStartTs;
      data.push({ x: relTs, y: Number(sd.raw_value ?? 0) });
      pR.push(2); pC.push(sigDef.color);

      if (withTail) {
        const tailPt: any = { x: relTs + 1, y: Number(sd.raw_value ?? 0), _tail: true };
        data.push(tailPt); pR.push(0); pC.push('transparent');
      }
    });
  }

  private rerenderVisibleCharts(): void {
    if (this.activeView !== 'charts') return;
    this.cdr.detectChanges();
    setTimeout(() => this.renderAllCharts(), 100);
  }

  private destroyAllCharts(): void {
    for (const g of this.messageGroups) {
      for (const card of g.cards) {
        card.chart?.destroy();
        card.chart = undefined;
      }
    }
    this.expandedChartInst?.destroy();
    this.expandedChartInst = undefined;
  }

  // ─── Expand overlay ──────────────────────────────────────────────────────────

  expandCard(card: ChartCard, msgName: string, event: MouseEvent): void {
    event.stopPropagation();
    this.expandedCard       = card;
    this.expandedCardMsgName = msgName;
    setTimeout(() => this.renderExpandedChart(), 80);
  }

  private renderExpandedChart(): void {
    if (!this.expandedCard) return;
    this.expandedChartInst?.destroy();
    const expId  = this.expandedCard.cardId + '-exp';
    const canvas = document.getElementById(expId) as HTMLCanvasElement | null;
    if (!canvas) return;

    const group = this.messageGroups.find(g => g.messageName === this.expandedCardMsgName);
    if (!group) return;

    this.expandedChartInst = this.buildEmptyChart(canvas, this.expandedCard, this.expandedCardMsgName);

    for (const frame of this.allFrames) {
      if (frame.message !== this.expandedCardMsgName) continue;
      this.expandedCard.signals.forEach((sigDef, idx) => {
        const sd = frame.signals[sigDef.signalName];
        if (!sd) return;
        const dataset = this.expandedChartInst!.data.datasets[idx];
        const data    = dataset.data as { x: number; y: number }[];
        const ds: any = dataset;
        data.push({ x: frame.timestamp - this.logStartTs, y: Number(sd.raw_value ?? 0) });
        (ds.pointRadius as number[]).push(2);
        (ds.pointBackgroundColor as string[]).push(sigDef.color);
      });
    }
    this.expandedChartInst.update();
  }

  closeExpanded(): void {
    this.expandedChartInst?.destroy();
    this.expandedChartInst = undefined;
    this.expandedCard = null;
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as Element).classList.contains('chart-expand-overlay')) {
      this.closeExpanded();
    }
  }

  resetZoom(): void {
    (this.expandedChartInst as any)?.resetZoom?.();
  }

  // ─── Template helpers ────────────────────────────────────────────────────────

  formatTimestamp(ts: number): string {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString('en-GB', { hour12: false }) +
      '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  formatRelative(ts: number): string {
    const diff = ts - this.logStartTs;
    return diff >= 0 ? `+${diff.toFixed(3)}s` : `${diff.toFixed(3)}s`;
  }

  msgColor(bus: string): string {
    const h = [...bus].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
    return `color: hsl(${h},70%,65%)`;
  }

  exportResults(): void {
    const blob = new Blob([JSON.stringify(this.allFrames, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `simulation_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
