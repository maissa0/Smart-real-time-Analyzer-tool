import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { DataTableComponent, type DataTableColumn } from '../../../shared/components/data-table';
import { TableSkeletonComponent } from '../../../shared/components/skeleton/table-skeleton.component';
import { BreadcrumbComponent } from '../../../shared/components/breadcrumb/breadcrumb.component';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { UserStore } from '../../../store/user.store';
import type { User } from '../../../data/models';
import { UserEditDrawerComponent } from '../user-edit-drawer/user-edit-drawer.component';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [DataTableComponent, UserEditDrawerComponent, TableSkeletonComponent, BreadcrumbComponent],
  templateUrl: './user-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserListComponent implements OnInit {
  readonly userStore = inject(UserStore);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly authService = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly searchInput$ = new Subject<string>();

  readonly showEditDrawer = signal(false);
  readonly selectedUser = signal<User | null>(null);

  /** Users from API (already filtered by UserStore filter/pagination) */
  readonly filteredUsers = computed(() => this.userStore.users());

  readonly columns: DataTableColumn<User>[] = [
    { key: 'index', header: '#', field: 'id', sortable: false, templateKey: 'index' },
    { key: 'profile', header: 'User Profile', field: 'fullName', sortable: true, templateKey: 'profile' },
    { key: 'status', header: 'Status', field: 'isActive', sortable: false, templateKey: 'status' },
  ];

  ngOnInit(): void {
    this.breadcrumb.set([
      { label: 'Home', url: '/admin' },
      { label: 'Users', url: '/admin/users/list' },
      { label: 'List' },
    ]);
    this.searchInput$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.userStore.setFilter({ search }));
  }

  readonly searchValue = signal('');

  onSearchInput(value: string): void {
    this.searchValue.set(value);
    this.searchInput$.next(value);
  }

  clearSearch(): void {
    this.searchValue.set('');
    this.userStore.setFilter({ search: '', status: 'all' });
  }

  onSortChange(event: { sortBy: string; sortDirection: 'asc' | 'desc' }): void {
    const sortByMap: Record<string, string> = {
      fullName: 'full_name',
      email: 'email',
      username: 'username',
      createdAt: 'created_at',
    };
    const backendSortBy = sortByMap[event.sortBy] ?? 'created_at';
    this.userStore.setFilter({ sortBy: backendSortBy, sortDirection: event.sortDirection });
  }

  onEdit(user: User): void {
    this.selectedUser.set(user);
    this.showEditDrawer.set(true);
  }

  onDeactivate(user: User): void {
    this.userStore.patchStatus(user.id);
  }

  onActivate(user: User): void {
    this.userStore.patchStatus(user.id);
  }

  onResetPassword(user: User): void {
    this.authService.forgotPassword(user.email).subscribe({
      next: () => this.toast.success('Reset email sent to ' + user.email),
      error: () => {},
    });
  }

  onDelete(user: User): void {
    if (confirm(`Are you sure you want to delete ${user.fullName ?? user.email}?`)) {
      this.userStore.deleteUser(user.id);
    }
  }

  onDrawerClosed(): void {
    this.showEditDrawer.set(false);
    this.selectedUser.set(null);
  }

  onUserSaved(updated: User): void {
    this.userStore.updateUser(updated);
    this.onDrawerClosed();
  }
}
