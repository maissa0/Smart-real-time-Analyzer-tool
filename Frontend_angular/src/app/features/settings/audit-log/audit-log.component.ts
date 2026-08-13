import { ChangeDetectionStrategy, Component, DestroyRef, input, inject, OnInit, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BreadcrumbComponent } from '../../../shared/components/breadcrumb/breadcrumb.component';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { AuditService } from '../../../core/services/audit.service';
import type { AuditLog } from '../../../core/models/audit-log.model';

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule, BreadcrumbComponent],
  templateUrl: './audit-log.component.html',
  styleUrl: './audit-log.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditLogComponent implements OnInit {
  private readonly breadcrumb  = inject(BreadcrumbService);
  private readonly auditService = inject(AuditService);
  private readonly destroyRef  = inject(DestroyRef);
  readonly embedded = input(false);
  readonly logs = signal<AuditLog[]>([]);
  readonly isLoading = signal(true);
  readonly selectedLog = signal<AuditLog | null>(null);
  readonly filterQuery = signal('');
  readonly filterAction = signal('');

  readonly filteredLogs = computed(() => {
    const q = this.filterQuery().toLowerCase().trim();
    const a = this.filterAction();
    return this.logs().filter(l =>
      (!a || l.action === a) &&
      (!q || l.action.toLowerCase().includes(q) ||
             l.resource.toLowerCase().includes(q) ||
             (l.ipAddress ?? '').toLowerCase().includes(q))
    );
  });

  readonly availableActions = computed(() =>
    [...new Set(this.logs().map(l => l.action))].sort()
  );

  ngOnInit(): void {
    if (!this.embedded()) {
      this.breadcrumb.set([
        { label: 'Home', url: '/admin' },
        { label: 'Settings', url: '/admin/settings/audit' },
        { label: 'Audit Trail' },
      ]);
    }
    this.loadLogs();
  }

  loadLogs(): void {
    this.isLoading.set(true);
    // When embedded in profile page → fetch only current user's own logs
    // When standalone (admin view) → fetch all logs
    const request$ = this.embedded()
      ? this.auditService.getMyAuditLogs(0, 20)
      : this.auditService.getAuditLogs(0, 20);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => { this.logs.set(page.content); this.isLoading.set(false); },
        error: () => { this.isLoading.set(false); },
      });
  }

  onViewMetadata(log: AuditLog): void {
    this.selectedLog.set(log);
  }

  closeMetadataView(): void {
    this.selectedLog.set(null);
  }

  filterQueryValue = '';
  filterActionValue = '';

  clearFilters(): void {
    this.filterQueryValue = '';
    this.filterActionValue = '';
    this.filterQuery.set('');
    this.filterAction.set('');
  }

  getMetadataDisplay(log: AuditLog): string {
    const meta = log.metadata ?? {};
    return JSON.stringify(meta, null, 2);
  }

  /** Maps an audit action to its badge color variant — presentational only. */
  actionBadgeClass(action: string): string {
    switch (action) {
      case 'LOGIN_SUCCESS':     return 'al-badge al-badge--login-success';
      case 'SIMULATION_START':  return 'al-badge al-badge--sim-start';
      case 'SIMULATION_STOP':   return 'al-badge al-badge--sim-stop';
      default:                  return 'al-badge al-badge--default';
    }
  }
}
