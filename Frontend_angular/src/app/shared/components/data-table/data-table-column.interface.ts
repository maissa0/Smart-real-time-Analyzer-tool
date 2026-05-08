import type { TemplateRef } from '@angular/core';

/**
 * Column configuration for DataTableComponent.
 * Supports custom cell rendering via template refs.
 */
export interface DataTableColumn<T> {
  /** Unique key for the column (used for sorting) */
  key: string;
  /** Display header label */
  header: string;
  /** Property path to extract value (e.g., 'full_name', 'email') */
  field?: keyof T | string;
  /** Whether this column is sortable */
  sortable?: boolean;
  /** Key to look up custom cell template in cellTemplates map */
  templateKey?: string;
  /** Optional CSS class for the column header/cell */
  headerClass?: string;
  /** Optional CSS class for the cell */
  cellClass?: string;
}

/** Context passed to custom cell templates */
export interface DataTableCellContext<T> {
  $implicit: T;
  column: DataTableColumn<T>;
  index?: number;
}

/** Context passed to actions template */
export interface DataTableActionsContext<T> {
  $implicit: T;
}
