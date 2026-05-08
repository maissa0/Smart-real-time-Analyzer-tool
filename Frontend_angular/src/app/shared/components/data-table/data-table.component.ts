import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  TemplateRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type {
  DataTableColumn,
  DataTableCellContext,
  DataTableActionsContext,
} from './data-table-column.interface';

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './data-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent<T extends object> {
  /** Data array */
  data = input.required<T[]>();

  /** Column definitions */
  columns = input.required<DataTableColumn<T>[]>();

  /** Map of templateKey -> TemplateRef for custom cell rendering */
  cellTemplates = input<Record<string, TemplateRef<DataTableCellContext<T>>>>({});

  /** Template ref for actions column */
  actionsTemplate = input<TemplateRef<DataTableActionsContext<T>> | null>(null);

  /** Page size options */
  pageSizeOptions = input<number[]>([5, 10, 25, 50]);

  /** Default page size */
  defaultPageSize = input(10);

  /** Server-side: total count from API (when set, disables client-side slicing) */
  serverTotalCount = input<number | null>(null);

  /** Server-side: current page from store (syncs when filter resets, etc.) */
  currentPageInput = input<number>(1);

  /** Sort change event */
  sortChange = output<{ sortBy: string; sortDirection: 'asc' | 'desc' }>();

  /** Page change event */
  pageChange = output<number>();

  /** Page size change event */
  pageSizeChange = output<number>();

  /** Internal pagination state */
  private readonly _currentPage = signal(1);
  private readonly _pageSize = signal(10);
  private readonly _sortBy = signal<string | null>(null);
  private readonly _sortDirection = signal<'asc' | 'desc'>('asc');

  /** Sorted and paginated data. In server mode, data is already one page from API. */
  readonly processedData = computed(() => {
    const rows = this.data();
    const sortBy = this._sortBy();
    const sortDir = this._sortDirection();
    const page = this._currentPage();
    const pageSize = this._pageSize();
    const serverTotal = this.serverTotalCount();

    let sorted = [...rows];

    if (sortBy && !serverTotal) {
      sorted = sorted.sort((a, b) => {
        const aVal = this.getFieldValue(a, sortBy);
        const bVal = this.getFieldValue(b, sortBy);
        const cmp = this.compare(aVal, bVal);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    if (serverTotal != null) {
      return sorted;
    }
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  });

  readonly totalPages = computed(() => {
    const total = this.serverTotalCount() ?? this.data().length;
    const pageSize = this._pageSize();
    return Math.ceil(total / pageSize) || 1;
  });

  readonly totalCount = computed(() =>
    this.serverTotalCount() ?? this.data().length
  );

  readonly currentPage = this._currentPage.asReadonly();
  readonly pageSize = this._pageSize.asReadonly();
  readonly sortBy = this._sortBy.asReadonly();
  readonly sortDirection = this._sortDirection.asReadonly();

  constructor() {
    effect(() => {
      this._pageSize.set(this.defaultPageSize());
    }, { allowSignalWrites: true });
    effect(() => {
      this._currentPage.set(this.currentPageInput());
    }, { allowSignalWrites: true });
  }

  getFieldValue(row: T, field: string | number | symbol): unknown {
    const keys = String(field).split('.');
    let val: unknown = row;
    for (const k of keys) {
      val = (val as Record<string, unknown>)?.[k];
    }
    return val;
  }

  private compare(a: unknown, b: unknown): number {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b);
    }
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    return String(a).localeCompare(String(b));
  }

  onSort(column: DataTableColumn<T>): void {
    if (!column.sortable) return;
    const key = column.field ?? column.key;
    const nextDir =
      this._sortBy() === key && this._sortDirection() === 'asc' ? 'desc' : 'asc';
    this._sortBy.set(key as string);
    this._sortDirection.set(nextDir);
    this.sortChange.emit({ sortBy: key as string, sortDirection: nextDir });
  }

  goToPage(page: number): void {
    const clamped = Math.max(1, Math.min(page, this.totalPages()));
    this._currentPage.set(clamped);
    this.pageChange.emit(clamped);
  }

  setPageSize(size: number): void {
    this._pageSize.set(size);
    this._currentPage.set(1);
    this.pageSizeChange.emit(size);
  }

  isSorted(column: DataTableColumn<T>): boolean {
    const key = column.field ?? column.key;
    return this._sortBy() === key;
  }

  readonly Math = Math;

  getCellTemplate(column: DataTableColumn<T>): TemplateRef<DataTableCellContext<T>> | null {
    const key = column.templateKey ?? column.key;
    return this.cellTemplates()[key] ?? null;
  }
}
