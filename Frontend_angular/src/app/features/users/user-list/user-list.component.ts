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
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { UserStore } from '../../../store/user.store';
import { UserService } from '../../../core/services/user.service';
import type { User } from '../../../data/models';
import { UserEditDrawerComponent } from '../user-edit-drawer/user-edit-drawer.component';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, UserEditDrawerComponent],
  templateUrl: './user-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserListComponent implements OnInit {
  readonly userStore  = inject(UserStore);
  private readonly breadcrumb  = inject(BreadcrumbService);
  private readonly authService = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly toast       = inject(ToastService);
  private readonly destroyRef  = inject(DestroyRef);
  private readonly fb          = inject(FormBuilder);
  private readonly searchInput$ = new Subject<string>();

  // ── table ────────────────────────────────────────────────────────────────
  readonly filteredUsers = computed(() => this.userStore.users());

  // ── edit drawer ──────────────────────────────────────────────────────────
  readonly showEditDrawer = signal(false);
  readonly selectedUser   = signal<User | null>(null);

  // ── invite modal ─────────────────────────────────────────────────────────
  readonly showInviteModal = signal(false);
  readonly isInviting      = signal(false);
  readonly inviteForm = this.fb.nonNullable.group({
    fullName:   ['', [Validators.required, Validators.minLength(2)]],
    email:      ['', [Validators.required, Validators.email]],
    jobTitle:   [''],
    department: [''],
    role:       ['ROLE_VIEWER'],
  });

  // ── deactivate modal ─────────────────────────────────────────────────────
  readonly showDeactivateModal  = signal(false);
  readonly deactivateTargetUser = signal<User | null>(null);
  readonly deactivateReason     = signal('');

  // ── delete confirm ───────────────────────────────────────────────────────
  readonly showDeleteModal  = signal(false);
  readonly deleteTargetUser = signal<User | null>(null);

  readonly searchValue = signal('');

  ngOnInit(): void {
    this.breadcrumb.set([
      { label: 'Home', url: '/admin' },
      { label: 'Users', url: '/admin/users/list' },
      { label: 'List' },
    ]);
    this.searchInput$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.userStore.setFilter({ search }));

    // Force reload every time the component mounts —
    // the store onInit only runs once on first injection.
    this.userStore.loadUsers();
  }

  // ── search ───────────────────────────────────────────────────────────────
  onSearchInput(value: string): void {
    this.searchValue.set(value);
    this.searchInput$.next(value);
  }
  clearSearch(): void {
    this.searchValue.set('');
    this.userStore.setFilter({ search: '', status: 'all' });
  }
  // ── edit drawer ──────────────────────────────────────────────────────────
  onEdit(user: User): void {
    this.selectedUser.set(user);
    this.showEditDrawer.set(true);
  }
  onDrawerClosed(): void {
    this.showEditDrawer.set(false);
    this.selectedUser.set(null);
  }
  onUserSaved(updated: User): void {
    this.userStore.updateUser(updated);
    this.onDrawerClosed();
  }

  // ── invite ───────────────────────────────────────────────────────────────
  openInviteModal(): void {
    this.inviteForm.reset({ role: 'ROLE_VIEWER' });
    this.showInviteModal.set(true);
  }
  closeInviteModal(): void { this.showInviteModal.set(false); }

  submitInvite(): void {
    if (this.inviteForm.invalid) { this.inviteForm.markAllAsTouched(); return; }
    this.isInviting.set(true);
    const { fullName, email, jobTitle, department, role } = this.inviteForm.getRawValue();
    this.userService.inviteUser({ fullName, email, jobTitle, department, role }).subscribe({
      next: () => {
        this.isInviting.set(false);
        this.showInviteModal.set(false);
        this.toast.success(`Invitation sent to ${email}`);
        this.userStore.loadUsers();
      },
      error: (err: any) => {
        this.isInviting.set(false);
        this.toast.error(err?.error?.message ?? 'Failed to invite user');
      },
    });
  }

  // ── deactivate with reason ────────────────────────────────────────────────
  openDeactivateModal(user: User): void {
    this.deactivateTargetUser.set(user);
    this.deactivateReason.set('');
    this.showDeactivateModal.set(true);
  }
  closeDeactivateModal(): void { this.showDeactivateModal.set(false); }

  confirmDeactivate(): void {
    const user = this.deactivateTargetUser();
    if (!user) return;
    this.userStore.patchStatus(user.id, this.deactivateReason());
    this.showDeactivateModal.set(false);
    this.toast.success(`${user.fullName ?? user.email} deactivated`);
  }

  onActivate(user: User): void {
    this.userStore.patchStatus(user.id);
    this.toast.success(`${user.fullName ?? user.email} activated`);
  }

  // ── delete ────────────────────────────────────────────────────────────────
  openDeleteModal(user: User): void {
    this.deleteTargetUser.set(user);
    this.showDeleteModal.set(true);
  }
  closeDeleteModal(): void { this.showDeleteModal.set(false); }

  confirmDelete(): void {
    const user = this.deleteTargetUser();
    if (!user) return;
    this.userStore.deleteUserById(user.id);
    this.showDeleteModal.set(false);
    this.toast.success(`${user.fullName ?? user.email} deleted`);
  }

  // ── reset password ────────────────────────────────────────────────────────
  onResetPassword(user: User): void {
    this.authService.forgotPassword(user.email).subscribe({
      next: () => this.toast.success('Reset email sent to ' + user.email),
      error: () => {},
    });
  }

  formatRole(name: string | undefined): string {
    if (!name) return 'Viewer';
    return name
      .replace('ROLE_', '')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
