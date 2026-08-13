import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { FleetService, Car, CarCatalog, CatalogSummary } from './fleet.service';
import { CarRequirementSet, RequirementSummary } from '../../core/models/requirement.model';
import { RequirementService } from '../../core/services/requirement.service';
import { NlQueryService, NlQueryResponse } from '../../core/services/nl-query.service';
import { CanSession } from '../../core/models/can.model';
import { CanService } from '../../core/services/can.service';
import { LogUploadComponent } from '../sniffer/upload/log-upload.component';
import { SimulatorControlComponent } from '../sniffer/simulator/simulator-control.component';
import { CatalogDetailPageComponent } from '../catalogs/catalog-detail-page.component';
import { RequirementDetailPageComponent } from '../requirements/requirement-detail-page.component';

/** Per-session integrity info derived from the existing faults endpoint. */
interface SessionFaultInfo {
  count: number;
  ruleIds: string[];
  typeCounts: Record<string, number>;
  ruleCounts: Record<string, number>;
}

/** Fault-rate target (faults / 1k frames) the Overview panel judges against. */
const FAULT_RATE_TARGET = 10;
/** How many recent sessions get their fault details fetched for the cards. */
const FAULT_SCAN_LIMIT = 30;

@Component({
  selector: 'app-fleet-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, LogUploadComponent, SimulatorControlComponent,
    CatalogDetailPageComponent, RequirementDetailPageComponent,
  ],
  templateUrl: './fleet-page.component.html',
  styleUrl: './fleet-page.component.scss',
})
export class FleetPageComponent implements OnInit {
  private readonly fleetService  = inject(FleetService);
  private readonly router        = inject(Router);
  private readonly route         = inject(ActivatedRoute);
  private readonly nlQueryService = inject(NlQueryService);
  private readonly requirementService = inject(RequirementService);
  private readonly canService    = inject(CanService);

  readonly cars            = signal<Car[]>([]);
  readonly loading         = signal(true);
  readonly showModal       = signal(false);
  readonly editingCar      = signal<Car | null>(null);
  readonly saving          = signal(false);
  readonly formError       = signal('');

  readonly selectedCar = signal<Car | null>(null);
  readonly selectedCarSessions = signal<CanSession[]>([]);
  readonly sessionsLoading = signal(false);

  // Inline session tools for the selected car (mirror of the workspace page)
  readonly showUpload    = signal(false);
  readonly showSimulator = signal(false);

  // Catalog assignment (selected-car modal)
  readonly carCatalogs        = signal<CarCatalog[]>([]);
  readonly showCatalogModal   = signal(false);
  readonly allCatalogs        = signal<CatalogSummary[]>([]);
  readonly selectedFilenames  = signal<Set<string>>(new Set());
  readonly catalogsSaving     = signal(false);
  readonly catalogsError      = signal('');

  // Requirement-set assignment (selected-car modal) — mirror of the catalog flow.
  // Empty assignment = requirements engine OFF for this car's sessions.
  readonly carRequirements       = signal<CarRequirementSet[]>([]);
  readonly showRequirementModal  = signal(false);
  readonly allRequirementSets    = signal<RequirementSummary[]>([]);
  readonly selectedReqFilenames  = signal<Set<string>>(new Set());
  readonly requirementsSaving    = signal(false);
  readonly requirementsError     = signal('');
  readonly reqUploading          = signal(false);

  // ── Vehicle-detail presentation state (tabs, filters, joins, toasts) ──────
  readonly activeTab = signal<'overview' | 'sessions' | 'catalogs' | 'requirements'>('overview');
  readonly sessionFilter = signal<'all' | 'faults' | 'clean'>('all');
  readonly sessionQuery = signal('');
  readonly allCatalogSummaries = signal<CatalogSummary[]>([]);
  readonly sessionFaults = signal<Map<string, SessionFaultInfo>>(new Map());
  readonly selectedCatalogFile = signal<string | null>(null);
  readonly selectedReqFile = signal<string | null>(null);
  readonly toasts = signal<{ id: number; text: string }[]>([]);
  private toastSeq = 0;

  readonly faultRateTarget = FAULT_RATE_TARGET;

  readonly sessionsNewestFirst = computed(() =>
    [...this.selectedCarSessions()].sort(
      (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));

  readonly recentSessions = computed(() => this.sessionsNewestFirst().slice(0, 3));

  readonly faultSessionCount = computed(() =>
    this.sessionsNewestFirst().filter(
      s => (this.sessionFaults().get(s.sessionId)?.count ?? 0) > 0).length);

  readonly cleanSessionCount = computed(() =>
    this.sessionsNewestFirst().length - this.faultSessionCount());

  readonly filteredSessions = computed(() => {
    const q = this.sessionQuery().toLowerCase().trim();
    const filter = this.sessionFilter();
    return this.sessionsNewestFirst().filter(s => {
      const faults = this.sessionFaults().get(s.sessionId)?.count ?? 0;
      if (filter === 'faults' && faults === 0) return false;
      if (filter === 'clean' && faults > 0) return false;
      if (q && !`${s.sessionId} ${s.sourceFilename ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  /** Attached catalogs enriched with message/signal counts from the summary list. */
  readonly catalogCards = computed(() => {
    const summaries = new Map(this.allCatalogSummaries().map(c => [c.filename, c]));
    return this.carCatalogs().map(c => ({
      ...c,
      messageCount: summaries.get(c.filename)?.messageCount ?? null,
      signalCount: summaries.get(c.filename)?.signalCount ?? null,
    }));
  });

  readonly totalSignals = computed(() =>
    this.catalogCards().reduce((acc, c) => acc + (c.signalCount ?? 0), 0));

  /** Attached requirement sets enriched with rule/draft counts + version. */
  readonly requirementCards = computed(() => {
    const infos = new Map(this.allRequirementSets().map(r => [r.filename, r]));
    return this.carRequirements().map(r => ({
      ...r,
      ruleCount: infos.get(r.filename)?.ruleCount ?? null,
      draftCount: infos.get(r.filename)?.draftCount ?? null,
      version: r.version ?? infos.get(r.filename)?.version ?? null,
    }));
  });

  readonly totalRules = computed(() =>
    this.requirementCards().reduce((acc, r) => acc + (r.ruleCount ?? 0), 0));

  /** True when the car's fault rate exceeds the target. */
  readonly overTarget = computed(() => {
    const rate = this.selectedCar()?.faultRate;
    return rate != null && rate > FAULT_RATE_TARGET;
  });

  /** Four newest sessions (oldest → newest) as trend bars + the target line. */
  readonly faultTrend = computed(() => {
    const points = this.sessionsNewestFirst().slice(0, 4).reverse().map(s => {
      const info = this.sessionFaults().get(s.sessionId);
      const frames = s.frameCount || 0;
      const rate = info && frames > 0 ? (info.count / frames) * 1000 : null;
      return { sessionId: s.sessionId, label: (s.createdAt || '').slice(5, 10), rate };
    });
    const max = Math.max(FAULT_RATE_TARGET * 1.4, ...points.map(p => p.rate ?? 0));
    return {
      bars: points.map(p => ({
        ...p,
        pct: p.rate == null ? 0 : Math.max(4, Math.round((p.rate / max) * 100)),
      })),
      targetPct: Math.round((FAULT_RATE_TARGET / max) * 100),
    };
  });

  /** Most frequent fault type across the scanned sessions + the rule it maps to. */
  readonly dominantFault = computed(() => {
    const typeTotals = new Map<string, number>();
    const ruleTotals = new Map<string, number>();
    for (const info of this.sessionFaults().values()) {
      for (const [t, n] of Object.entries(info.typeCounts)) {
        typeTotals.set(t, (typeTotals.get(t) ?? 0) + n);
      }
      for (const [r, n] of Object.entries(info.ruleCounts)) {
        ruleTotals.set(r, (ruleTotals.get(r) ?? 0) + n);
      }
    }
    const top = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    const topType = top(typeTotals);
    const topRule = top(ruleTotals);
    if (!topType) return null;
    return { type: topType[0], count: topType[1], rule: topRule ? topRule[0] : null };
  });

  /** "Traffic from BUS_A, BUS_B · checked against Set X" — from attached data. */
  readonly simulatorSubtitle = computed(() => {
    const buses = this.carCatalogs().map(c => c.busName || c.name || c.filename);
    const sets = this.carRequirements().map(r => r.name || r.filename);
    const busPart = buses.length > 0
      ? `Traffic from ${buses.join(', ')}`
      : 'Traffic from all catalogs (none assigned)';
    const setPart = sets.length > 0
      ? `checked against ${sets.join(', ')}`
      : 'no requirement sets assigned';
    return `${busPart} · ${setPart}`;
  });

  /** Explicit thousands separators — locale-independent by design. */
  formatNum(n: number | null | undefined): string {
    if (n == null) return '—';
    const sign = n < 0 ? '-' : '';
    const digits = Math.trunc(Math.abs(n)).toString();
    return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  formatRate(n: number | null | undefined): string {
    return n == null ? '—' : n.toFixed(1);
  }

  faultInfo(sessionId: string): SessionFaultInfo | undefined {
    return this.sessionFaults().get(sessionId);
  }

  /** Session card edge/outcome: red = faults or error, green = clean, amber = pending. */
  sessionOutcome(s: CanSession): 'fault' | 'clean' | 'pending' {
    if (s.status === 'ERROR') return 'fault';
    const info = this.sessionFaults().get(s.sessionId);
    if (!info || (s.status && s.status !== 'COMPLETE')) return info?.count ? 'fault' : 'pending';
    return info.count > 0 ? 'fault' : 'clean';
  }

  pushToast(text: string): void {
    const id = ++this.toastSeq;
    this.toasts.update(list => [...list, { id, text }]);
    setTimeout(
      () => this.toasts.update(list => list.filter(t => t.id !== id)),
      4000);
  }

  /** Breadcrumb: back to the fleet list (clears the ?car query param). */
  clearSelection(): void {
    this.selectedCar.set(null);
    this.selectedCarSessions.set([]);
    this.showUpload.set(false);
    this.showSimulator.set(false);
    this.router.navigate([], {
      queryParams: { car: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  selectCatalog(filename: string): void {
    this.selectedCatalogFile.set(filename);
  }

  selectRequirement(filename: string): void {
    this.selectedReqFile.set(filename);
  }

  onSimulatorStarted(): void {
    this.onSimulatorChanged();
    this.showSimulator.set(false);
    this.activeTab.set('sessions');
    this.pushToast('Simulator started — a new session is being captured.');
  }

  onSimulatorStopped(): void {
    this.onSimulatorChanged();
    this.pushToast('Simulator stopped.');
  }

  onCatalogSaved(): void {
    this.pushToast('Catalog saved.');
    const car = this.selectedCar();
    if (!car) return;
    this.fleetService.getCarCatalogs(car.carUid).subscribe({
      next: catalogs => this.carCatalogs.set(catalogs),
      error: () => {},
    });
    this.fleetService.getAllCatalogs().subscribe({
      next: s => this.allCatalogSummaries.set(s),
      error: () => {},
    });
  }

  onRequirementSaved(): void {
    this.pushToast('Requirement set saved.');
    const car = this.selectedCar();
    if (!car) return;
    this.fleetService.getCarRequirements(car.carUid).subscribe({
      next: sets => this.carRequirements.set(sets),
      error: () => {},
    });
    this.fleetService.getAllRequirementSets().subscribe({
      next: sets => this.allRequirementSets.set(sets),
      error: () => {},
    });
  }

  /** Keep a valid catalog selected after assign/remove/delete mutations. */
  private syncCatalogSelection(): void {
    const list = this.carCatalogs();
    if (!list.some(c => c.filename === this.selectedCatalogFile())) {
      this.selectedCatalogFile.set(list[0]?.filename ?? null);
    }
  }

  private syncRequirementSelection(): void {
    const list = this.carRequirements();
    if (!list.some(r => r.filename === this.selectedReqFile())) {
      this.selectedReqFile.set(list[0]?.filename ?? null);
    }
  }

  /** Fetch fault info for the newest sessions through the existing endpoint. */
  private loadSessionFaults(sessions: CanSession[]): void {
    const recent = [...sessions]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, FAULT_SCAN_LIMIT);
    for (const s of recent) {
      if (this.sessionFaults().has(s.sessionId)) continue;
      this.canService.getIntegrityFaults(s.sessionId).subscribe({
        next: faults => {
          const typeCounts: Record<string, number> = {};
          const ruleCounts: Record<string, number> = {};
          const ruleIds: string[] = [];
          for (const f of faults) {
            typeCounts[f.faultType] = (typeCounts[f.faultType] ?? 0) + 1;
            const rule = f.requirementId || null;
            if (rule) ruleCounts[rule] = (ruleCounts[rule] ?? 0) + 1;
            const id = f.requirementId || f.faultType;
            if (!ruleIds.includes(id)) ruleIds.push(id);
          }
          this.sessionFaults.update(m => {
            const next = new Map(m);
            next.set(s.sessionId, { count: faults.length, ruleIds, typeCounts, ruleCounts });
            return next;
          });
        },
        error: () => { /* leave unknown — card falls back to pending */ },
      });
    }
  }

  // Catalog selection inside the Add/Edit Vehicle modal
  readonly formCatalogs = signal<Set<string>>(new Set());
  readonly catalogUploading = signal(false);
  readonly formCatalogList   = computed(() => [...this.formCatalogs()].sort());
  readonly assignCatalogList = computed(() => [...this.selectedFilenames()].sort());

  /** Selected files not yet in the system list — fresh uploads shown as chips. */
  readonly pendingUploadChips = computed(() => {
    const known = new Set(this.allCatalogs().map(c => c.filename));
    return [...this.selectedFilenames()].filter(f => !known.has(f)).sort();
  });

  // NL query
  readonly nlLoading = signal(false);
  readonly nlResult  = signal<NlQueryResponse | null>(null);
  readonly nlError   = signal('');
  readonly nlColumns = computed(() => {
    const r = this.nlResult();
    if (!r || r.results.length === 0) return [];
    return Object.keys(r.results[0]);
  });
  nlQuestion = '';

  readonly nlResultType = computed<'sessions' | 'vehicles' | 'signals' | 'generic'>(() => {
    const r = this.nlResult();
    if (!r || r.results.length === 0) return 'generic';
    const first = r.results[0];
    if (r.queryType === 'flux') return 'signals';
    if ('frame_count' in first && 'session_id' in first) return 'sessions';
    if ('make' in first || 'car_uid' in first) return 'vehicles';
    return 'generic';
  });

  readonly nlSessionGroups = computed(() => {
    const r = this.nlResult();
    if (!r || this.nlResultType() !== 'sessions') return [];
    const map = new Map<string, Record<string, unknown>[]>();
    for (const row of r.results) {
      const key = String(row['status'] ?? 'UNKNOWN');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    const order = ['COMPLETE', 'ERROR', 'PROCESSING', 'UNKNOWN'];
    return Array.from(map.entries())
      .sort(([a], [b]) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99 || a.localeCompare(b))
      .map(([status, rows]) => ({ status, rows }));
  });

  readonly nlVehicleGroups = computed(() => {
    const r = this.nlResult();
    if (!r || this.nlResultType() !== 'vehicles') return [];
    const map = new Map<string, Record<string, unknown>[]>();
    for (const row of r.results) {
      const key = String(row['make'] ?? 'Unknown');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([make, rows]) => ({ make, rows }));
  });

  readonly nlFrameGroups = computed(() => {
    const r = this.nlResult();
    if (!r || r.queryType !== 'flux') return [];
    const sessionIds = new Set(r.results.map(row => String(row['session_id'] ?? '')));
    const multiSession = sessionIds.size > 1;
    const map = new Map<string, Record<string, unknown>[]>();
    for (const row of r.results) {
      const sid = multiSession ? String(row['session_id'] ?? '').slice(0, 8) : '';
      const key = multiSession ? `${sid}::${row['msg_id']}` : String(row['msg_id'] ?? 'unknown');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => {
        const [sessionPrefix, msgId] = key.includes('::') ? key.split('::') : ['', key];
        return { msgId, sessionPrefix, rows };
      });
  });

  readonly expandedFrames = signal(new Set<string>());
  readonly collapsedGroups = signal(new Set<string>());

  readonly physicalCount = computed(() => this.cars().filter(c => !c.isVirtual).length);
  readonly virtualCount  = computed(() => this.cars().filter(c => c.isVirtual).length);
  readonly activeCount   = computed(() => this.cars().filter(c => c.isActive).length);

  readonly fleetMode = signal<'registry' | 'ai'>('registry');
  readonly searchQuery = signal('');

  readonly filteredCars = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.cars();
    return this.cars().filter(c =>
      `${c.make} ${c.model} ${c.year} ${c.vin ?? ''}`.toLowerCase().includes(q)
    );
  });

  form = { make: '', model: '', year: new Date().getFullYear(), color: '', vin: '', isVirtual: false };

  ngOnInit(): void { this.loadCars(); }

  loadCars(): void {
    this.loading.set(true);
    this.fleetService.getCars()
      .subscribe({
        next: cars => {
          this.cars.set(cars);
          this.loading.set(false);
          this.restoreSelectedCarFromUrl(cars);
        },
        error: () => this.loading.set(false),
      });
  }

  private restoreSelectedCarFromUrl(cars: Car[]): void {
    if (this.selectedCar()) return;
    const carUid = this.route.snapshot.queryParamMap.get('car');
    // Deep link wins; otherwise auto-select the first vehicle so the merged
    // page always shows a detail column.
    const car = (carUid ? cars.find(c => c.carUid === carUid) : undefined) ?? cars[0];
    if (car) this.selectCar(car);
  }

  selectCar(car: Car): void {
    this.selectedCar.set(car);
    this.selectedCarSessions.set([]);
    this.sessionsLoading.set(true);
    // Close the inline tools so reopening re-binds them to the new car.
    this.showUpload.set(false);
    this.showSimulator.set(false);
    // Reset the detail-page presentation state for the new car.
    this.activeTab.set('overview');
    this.sessionFilter.set('all');
    this.sessionQuery.set('');
    this.sessionFaults.set(new Map());
    this.selectedCatalogFile.set(null);
    this.selectedReqFile.set(null);
    this.carCatalogs.set([]);
    this.fleetService.getCarCatalogs(car.carUid).subscribe({
      next: catalogs => {
        this.carCatalogs.set(catalogs);
        this.syncCatalogSelection();
      },
      error: () => this.carCatalogs.set([]),
    });
    this.carRequirements.set([]);
    this.fleetService.getCarRequirements(car.carUid).subscribe({
      next: sets => {
        this.carRequirements.set(sets);
        this.syncRequirementSelection();
      },
      error: () => this.carRequirements.set([]),
    });
    // Card enrichment (message/signal + rule/draft counts) from existing lists.
    this.fleetService.getAllCatalogs().subscribe({
      next: s => this.allCatalogSummaries.set(s),
      error: () => {},
    });
    this.fleetService.getAllRequirementSets().subscribe({
      next: sets => this.allRequirementSets.set(sets),
      error: () => {},
    });
    this.router.navigate([], {
      queryParams: { car: car.carUid },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.fleetService.getCarSessions(car.carUid).subscribe({
      next: sessions => {
        this.selectedCarSessions.set(sessions);
        this.sessionsLoading.set(false);
        this.loadSessionFaults(sessions);
      },
      error: () => this.sessionsLoading.set(false),
    });
  }

  analyseSession(sessionId: string): void {
    this.router.navigate(['/admin/workspace/session', sessionId], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  toggleUpload(): void {
    this.showUpload.update(v => !v);
    if (this.showUpload()) this.showSimulator.set(false);
  }

  toggleSimulator(): void {
    this.showSimulator.update(v => !v);
    if (this.showSimulator()) this.showUpload.set(false);
  }

  refreshSelectedCarSessions(): void {
    const car = this.selectedCar();
    if (!car) return;
    this.sessionsLoading.set(true);
    this.fleetService.getCarSessions(car.carUid).subscribe({
      next: sessions => {
        this.selectedCarSessions.set(sessions);
        this.sessionsLoading.set(false);
        this.loadSessionFaults(sessions);
      },
      error: () => this.sessionsLoading.set(false),
    });
  }

  onUploadComplete(): void {
    this.refreshSelectedCarSessions();
    this.showUpload.set(false);
    this.activeTab.set('sessions');
    this.pushToast('Log analysed — session added.');
  }

  onSimulatorChanged(): void {
    this.refreshSelectedCarSessions();
  }

  openAddModal(): void {
    this.editingCar.set(null);
    this.form = { make: '', model: '', year: new Date().getFullYear(), color: '', vin: '', isVirtual: false };
    this.formError.set('');
    this.formCatalogs.set(new Set());
    this.showModal.set(true);
  }

  openEditModal(car: Car): void {
    this.editingCar.set(car);
    this.form = { make: car.make, model: car.model, year: car.year, color: car.color || '', vin: car.vin || '', isVirtual: car.isVirtual };
    this.formError.set('');
    // Edit is only reachable from the detail panel, so carCatalogs holds this
    // car's current assignment — prefill so save keeps it unless changed.
    this.formCatalogs.set(new Set(this.carCatalogs().map(c => c.filename)));
    this.showModal.set(true);
  }

  /** Open the full decode view of a catalog file. The current URL (which
   *  carries ?car=<uid>) rides along so the detail page's Back button returns
   *  here with the same car selected. */
  openCatalogDetail(filename: string): void {
    this.router.navigate(['/admin/catalogs', filename],
      { queryParams: { returnUrl: this.router.url } });
  }

  /** Open the rule view of a requirement-set file (same Back behavior). */
  openRequirementDetail(filename: string): void {
    this.router.navigate(['/admin/requirements', filename],
      { queryParams: { returnUrl: this.router.url } });
  }

  /** Collapse state of the two asset sections in the car detail pane. */
  readonly catalogsCollapsed = signal(false);
  readonly requirementsCollapsed = signal(false);

  toggleCatalogsSection(): void {
    this.catalogsCollapsed.update(v => !v);
  }

  toggleRequirementsSection(): void {
    this.requirementsCollapsed.update(v => !v);
  }

  /** Unassign a catalog from the selected car — the file itself is kept. */
  removeCarCatalog(filename: string): void {
    const car = this.selectedCar();
    if (!car) return;
    if (!confirm(`Remove "${filename}" from ${car.make} ${car.model}?\nThe catalog file itself is kept and can be re-assigned later.`)) return;
    const remaining = this.carCatalogs().map(c => c.filename).filter(f => f !== filename);
    this.fleetService.setCarCatalogs(car.carUid, remaining).subscribe({
      next: catalogs => {
        this.carCatalogs.set(catalogs);
        this.syncCatalogSelection();
      },
      error: () => { /* interceptor toasts */ },
    });
  }

  /** Permanently delete a catalog file — disappears for every car. */
  deleteCatalogFile(filename: string): void {
    if (!confirm(`Permanently DELETE the catalog file "${filename}"?\nIt will disappear for every car that uses it. This cannot be undone.`)) return;
    this.fleetService.deleteCatalogFile(filename).subscribe({
      next: () => {
        this.carCatalogs.update(list => list.filter(c => c.filename !== filename));
        this.syncCatalogSelection();
      },
      error: () => { /* interceptor toasts */ },
    });
  }

  /** Unassign a requirement set from the selected car — the file itself is kept. */
  removeCarRequirement(filename: string): void {
    const car = this.selectedCar();
    if (!car) return;
    if (!confirm(`Remove "${filename}" from ${car.make} ${car.model}?\nThe requirement file itself is kept and can be re-assigned later.`)) return;
    const remaining = this.carRequirements().map(r => r.filename).filter(f => f !== filename);
    this.fleetService.setCarRequirements(car.carUid, remaining).subscribe({
      next: sets => {
        this.carRequirements.set(sets);
        this.syncRequirementSelection();
      },
      error: () => { /* interceptor toasts */ },
    });
  }

  /** Permanently delete a requirement-set file — disappears for every car. */
  deleteRequirementFile(filename: string): void {
    if (!confirm(`Permanently DELETE the requirement set "${filename}"?\nIt will disappear for every car that uses it. This cannot be undone.`)) return;
    this.fleetService.deleteRequirementSetFile(filename).subscribe({
      next: () => {
        this.carRequirements.update(list => list.filter(r => r.filename !== filename));
        this.syncRequirementSelection();
      },
      error: () => { /* interceptor toasts */ },
    });
  }

  toggleFormCatalog(filename: string): void {
    this.formCatalogs.update(s => {
      const next = new Set(s);
      next.has(filename) ? next.delete(filename) : next.add(filename);
      return next;
    });
  }

  // ── Catalog file intake (browse / drag-drop / paste) ──────────────────────

  onCatalogFileInput(event: Event, target: 'form' | 'assign'): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.addCatalogFiles(Array.from(input.files), target);
    input.value = '';
  }

  onCatalogDrop(event: DragEvent, target: 'form' | 'assign'): void {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length) this.addCatalogFiles(Array.from(files), target);
  }

  onCatalogPaste(event: ClipboardEvent, target: 'form' | 'assign'): void {
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      this.addCatalogFiles(Array.from(files), target);
    }
  }

  /**
   * Uploads each picked XML through the catalog API (which saves the file and
   * reloads the backend catalog set), then adds the stored filename to the
   * target selection: 'form' = Add/Edit Vehicle modal, 'assign' = Catalogs modal.
   */
  private addCatalogFiles(files: File[], target: 'form' | 'assign'): void {
    const setError = (msg: string) =>
      target === 'form' ? this.formError.set(msg) : this.catalogsError.set(msg);
    const xmls = files.filter(f => f.name.toLowerCase().endsWith('.xml'));
    if (xmls.length === 0) {
      setError('Only .xml catalog files are supported.');
      return;
    }
    setError('');
    this.catalogUploading.set(true);
    let remaining = xmls.length;
    for (const file of xmls) {
      this.fleetService.uploadCatalog(file).subscribe({
        next: res => {
          const filename = res.filename || file.name;
          const add = (s: Set<string>) => { const n = new Set(s); n.add(filename); return n; };
          if (target === 'form') this.formCatalogs.update(add);
          else this.selectedFilenames.update(add);
          if (--remaining === 0) this.catalogUploading.set(false);
        },
        error: err => {
          setError(err?.error?.error || `Upload failed for ${file.name}.`);
          if (--remaining === 0) this.catalogUploading.set(false);
        },
      });
    }
  }

  closeModal(): void { this.showModal.set(false); this.editingCar.set(null); }

  saveVehicle(): void {
    if (!this.form.make.trim() || !this.form.model.trim() || !this.form.year) {
      this.formError.set('Make, Model, and Year are required.'); return;
    }
    this.saving.set(true);
    this.formError.set('');
    const body = { make: this.form.make.trim(), model: this.form.model.trim(), year: this.form.year, color: this.form.color || null, vin: this.form.vin || null, isVirtual: this.form.isVirtual };
    const editing = this.editingCar();
    const req = editing
      ? this.fleetService.updateCar(editing.carUid, body)
      : this.fleetService.createCar(body);
    req.subscribe({
      next: saved => {
        // Chain the catalog assignment: create/update the car first, then PUT
        // its catalog set. Skipped only for a brand-new car with no selection.
        const carUid = editing ? editing.carUid : saved.carUid;
        const filenames = [...this.formCatalogs()];
        if (!editing && filenames.length === 0) {
          this.saving.set(false); this.closeModal(); this.loadCars();
          return;
        }
        this.fleetService.setCarCatalogs(carUid, filenames).subscribe({
          next: catalogs => {
            if (this.selectedCar()?.carUid === carUid) this.carCatalogs.set(catalogs);
            this.saving.set(false); this.closeModal(); this.loadCars();
          },
          error: () => {
            this.saving.set(false);
            this.formError.set('Vehicle saved, but the catalog assignment failed - use the Catalogs button to retry.');
            this.loadCars();
          },
        });
      },
      error: err => { this.saving.set(false); this.formError.set(err?.error?.message || 'Save failed.'); }
    });
  }

  deleteCar(car: Car): void {
    if (!confirm(`Delete ${car.make} ${car.model} ${car.year}? This cannot be undone.`)) return;
    this.fleetService.deleteCar(car.carUid).subscribe({
      next: () => {
        if (this.selectedCar()?.carUid === car.carUid) {
          this.selectedCar.set(null);
          this.selectedCarSessions.set([]);
          this.router.navigate([], { queryParams: { car: null }, queryParamsHandling: 'merge', replaceUrl: true });
        }
        this.loadCars();
      },
      error: () => {},
    });
  }

  // ── Catalog assignment ─────────────────────────────────────────────────────

  openCatalogModal(): void {
    const car = this.selectedCar();
    if (!car) return;
    this.catalogsError.set('');
    this.selectedFilenames.set(new Set(this.carCatalogs().map(c => c.filename)));
    // Existing catalogs in the system, offered as checkboxes next to the upload.
    this.fleetService.getAllCatalogs().subscribe({
      next: catalogs => this.allCatalogs.set(catalogs),
      error: () => this.allCatalogs.set([]),
    });
    this.showCatalogModal.set(true);
  }

  closeCatalogModal(): void {
    this.showCatalogModal.set(false);
    this.catalogsError.set('');
  }

  toggleCatalogSelection(filename: string): void {
    this.selectedFilenames.update(s => {
      const next = new Set(s);
      next.has(filename) ? next.delete(filename) : next.add(filename);
      return next;
    });
  }

  saveCatalogs(): void {
    const car = this.selectedCar();
    if (!car) return;
    this.catalogsSaving.set(true);
    this.catalogsError.set('');
    this.fleetService.setCarCatalogs(car.carUid, [...this.selectedFilenames()]).subscribe({
      next: catalogs => {
        this.carCatalogs.set(catalogs);
        this.syncCatalogSelection();
        this.catalogsSaving.set(false);
        this.showCatalogModal.set(false);
        this.pushToast('Catalog assignment saved.');
      },
      error: err => {
        this.catalogsSaving.set(false);
        this.catalogsError.set(err?.error?.message || 'Could not save catalog assignment.');
      },
    });
  }

  // ── Requirement-set assignment (mirror of catalog assignment) ──────────────

  openRequirementModal(): void {
    const car = this.selectedCar();
    if (!car) return;
    this.requirementsError.set('');
    this.selectedReqFilenames.set(new Set(this.carRequirements().map(r => r.filename)));
    this.fleetService.getAllRequirementSets().subscribe({
      next: sets => this.allRequirementSets.set(sets),
      error: () => this.requirementsError.set('Could not load requirement sets.'),
    });
    this.showRequirementModal.set(true);
  }

  closeRequirementModal(): void {
    this.showRequirementModal.set(false);
    this.requirementsError.set('');
  }

  toggleRequirementSelection(filename: string): void {
    this.selectedReqFilenames.update(s => {
      const next = new Set(s);
      next.has(filename) ? next.delete(filename) : next.add(filename);
      return next;
    });
  }

  saveRequirements(): void {
    const car = this.selectedCar();
    if (!car) return;
    this.requirementsSaving.set(true);
    this.requirementsError.set('');
    this.fleetService.setCarRequirements(car.carUid, [...this.selectedReqFilenames()]).subscribe({
      next: sets => {
        this.carRequirements.set(sets);
        this.syncRequirementSelection();
        this.requirementsSaving.set(false);
        this.showRequirementModal.set(false);
        this.pushToast('Requirement assignment saved.');
      },
      error: err => {
        this.requirementsSaving.set(false);
        this.requirementsError.set(err?.error?.message || 'Could not save requirement assignment.');
      },
    });
  }

  /**
   * Phase B chooser, option 1: upload a requirement YAML from the car's modal.
   * The new set is selected and the assignment saved immediately (auto-assign).
   */
  uploadRequirementForCar(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.reqUploading.set(true);
    this.requirementsError.set('');
    this.requirementService.upload(file).subscribe({
      next: saved => {
        this.reqUploading.set(false);
        this.selectedReqFilenames.update(s => new Set(s).add(saved.filename));
        this.fleetService.getAllRequirementSets().subscribe({
          next: sets => this.allRequirementSets.set(sets),
        });
        this.saveRequirements();
      },
      error: err => {
        this.reqUploading.set(false);
        this.requirementsError.set(err?.error?.error || `Upload failed for ${file.name}.`);
      },
    });
  }

  /** Phase B chooser, option 2: create a new set pre-assigned to this car. */
  createRequirementForCar(): void {
    const car = this.selectedCar();
    if (!car) return;
    this.closeRequirementModal();
    this.router.navigate(['/admin/requirements/new'], {
      queryParams: { car: car.carUid },
    });
  }

  toggleGroup(key: string): void {
    this.collapsedGroups.update(s => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  toggleFrame(msgId: string): void {
    this.expandedFrames.update(s => {
      const next = new Set(s);
      next.has(msgId) ? next.delete(msgId) : next.add(msgId);
      return next;
    });
  }

  runNlQuery(): void {
    const q = this.nlQuestion.trim();
    if (!q) return;
    this.nlLoading.set(true);
    this.nlError.set('');
    this.nlResult.set(null);
    this.collapsedGroups.set(new Set());
    this.expandedFrames.set(new Set());
    this.nlQueryService.query(q).subscribe({
      next: res => { this.nlResult.set(res); this.nlLoading.set(false); },
      error: err => {
        this.nlError.set(err?.error?.error ?? 'Query failed. Try rephrasing.');
        this.nlLoading.set(false);
      },
    });
  }

  clearNlResult(): void {
    this.nlResult.set(null);
    this.nlError.set('');
    this.nlQuestion = '';
  }
}