/**
 * Filter and sort criteria for UserStore.
 * Binary active/inactive only - no status ENUM.
 */
export type UserStatusFilter = 'all' | 'active' | 'inactive';

export interface UserFilterCriteria {
  search: string;
  status: UserStatusFilter;
  sortBy: string;
  sortDirection: 'asc' | 'desc';
}

export interface PaginationState {
  page: number;
  pageSize: number;
  totalCount: number;
}
