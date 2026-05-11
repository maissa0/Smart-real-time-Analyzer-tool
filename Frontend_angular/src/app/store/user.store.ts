import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import type { User } from '../data/models';
import type { PaginationState, UserFilterCriteria } from '../data/types/filter.types';
import { UserService } from '../core/services/user.service';

export interface UserStoreState {
  users: User[];
  isLoading: boolean;
  error: string | null;
  filter: UserFilterCriteria;
  pagination: PaginationState;
}

const defaultFilter: UserFilterCriteria = {
  search: '',
  status: 'all',
  sortBy: 'created_at',
  sortDirection: 'desc',
};

const defaultPagination: PaginationState = {
  page: 1,
  pageSize: 10,
  totalCount: 0,
};

const initialState: UserStoreState = {
  users: [],
  isLoading: false,
  error: null,
  filter: defaultFilter,
  pagination: defaultPagination,
};

export const UserStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ users, isLoading, filter, pagination }) => ({
    hasUsers: computed(() => users().length > 0),
    totalPages: computed(() =>
      Math.ceil(pagination().totalCount / pagination().pageSize) || 1
    ),
    hasNextPage: computed(
      () => pagination().page < Math.ceil(pagination().totalCount / pagination().pageSize)
    ),
    hasPrevPage: computed(() => pagination().page > 1),
  })),
  withMethods((store, userService = inject(UserService)) => {
    const fetchUsers = (): void => {
      const f = store.filter();
      const p = store.pagination();
      const page = p.page;
      const pageSize = p.pageSize || 10;
      patchState(store, { isLoading: true, error: null });
      userService.getUsers(f, page, pageSize).subscribe({
        next: (pageRes) =>
          patchState(store, {
            users: pageRes.content,
            isLoading: false,
            error: null,
            pagination: {
              ...store.pagination(),
              totalCount: pageRes.totalElements,
            },
          }),
        error: (err: Error) =>
          patchState(store, {
            isLoading: false,
            error: err.message ?? 'Failed to load users',
          }),
      });
    };
    return {
    loadUsers: fetchUsers,
    updateUser(updatedUser: User): void {
      const users = store.users().map((u) =>
        u.id === updatedUser.id ? updatedUser : u
      );
      patchState(store, { users });
    },
    patchStatus(userId: string, reason?: string): void {
      userService.toggleStatus(userId, reason).subscribe({
        next: () => fetchUsers(),
        error: (err: Error) =>
          patchState(store, { error: err.message ?? 'Failed to update status' }),
      });
    },

    deleteUserById(userId: string): void {
      userService.deleteUser(userId).subscribe({
        next: () => fetchUsers(),
        error: (err: Error) =>
          patchState(store, { error: err.message ?? 'Failed to delete user' }),
      });
    },
    setFilter(partial: Partial<UserFilterCriteria>): void {
      patchState(store, {
        filter: { ...store.filter(), ...partial },
        pagination: { ...store.pagination(), page: 1 },
      });
      fetchUsers();
    },
    setPage(page: number): void {
      patchState(store, {
        pagination: { ...store.pagination(), page },
      });
      fetchUsers();
    },
    setPageSize(pageSize: number): void {
      patchState(store, {
        pagination: { ...store.pagination(), pageSize, page: 1 },
      });
      fetchUsers();
    },
    setLoading(isLoading: boolean): void {
      patchState(store, { isLoading });
    },
    setError(error: string | null): void {
      patchState(store, { error, isLoading: false });
    },
    reset(): void {
      patchState(store, initialState);
    },
  };
  }),
  withHooks({
    onInit(store) {
      store.loadUsers();
    },
  })
);
