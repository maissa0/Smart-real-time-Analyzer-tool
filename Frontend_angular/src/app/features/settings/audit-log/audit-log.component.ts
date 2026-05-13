import { ChangeDetectionStrategy, Component, input, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BreadcrumbComponent } from '../../../shared/components/breadcrumb/breadcrumb.component';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { AuditService } from '../../../core/services/audit.service';
import type { AuditLog } from '../../../data/models/audit-log.model';

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, BreadcrumbComponent],
  templateUrl: './audit-log.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditLogComponent implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auditService = inject(AuditService);
  readonly embedded = input(false);
  readonly logs = signal<AuditLog[]>([]);
  readonly isLoading = signal(true);
  readonly selectedLog = signal<AuditLog | null>(null);

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

    request$.subscribe({
      next: (page) => {
        this.logs.set(page.content);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  onViewMetadata(log: AuditLog): void {
    this.selectedLog.set(log);
  }

  closeMetadataView(): void {
    this.selectedLog.set(null);
  }

  getMetadataDisplay(log: AuditLog): string {
    const meta = log.metadata ?? {};
    return JSON.stringify(meta, null, 2);
  }
}
