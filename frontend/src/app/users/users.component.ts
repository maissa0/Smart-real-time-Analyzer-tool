import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import {
  CreateUserPayload, UpdateUserPayload,
  UserApiService, UserRecord,
} from '../services/user-api.service';
import { API_BASE_URL } from '../config/api.config';
import { swal, isDuplicate, duplicateText } from '../utils/swal';

interface FieldErrors {
  username?: string;
  email?:    string;
  password?: string;
  role?:     string;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users.component.html',
  styleUrl:    './users.component.css',
})
export class UsersComponent implements OnInit {
  private readonly api    = inject(UserApiService);
  private readonly auth   = inject(AuthService);
  private readonly router = inject(Router);
  private readonly cdr    = inject(ChangeDetectorRef);

  username    = '';
  sidebarOpen = false;
  isAdmin     = false;

  users:   UserRecord[] = [];
  loading  = true;
  apiError = '';

  // ── Add modal ────────────────────────────────────────────────────────────
  showAddModal = false;
  addForm: CreateUserPayload = { username: '', email: '', password: '', role: 'USER' };
  addErrors:  FieldErrors = {};
  addApiError = '';
  addSaving   = false;

  // ── Edit modal ───────────────────────────────────────────────────────────
  editingUser: UserRecord | null = null;
  editForm: UpdateUserPayload = { username: '', email: '', role: 'USER' };
  editErrors:  FieldErrors = {};
  editApiError = '';
  editSaving   = false;

  // ── Delete confirmation (handled via SweetAlert2) ─────────────────────────

  readonly API_BASE_URL = API_BASE_URL;

  ngOnInit(): void {
    this.username = this.auth.getCurrentUser() ?? 'user';
    this.isAdmin  = this.auth.isAdmin();
    this.loadUsers();
  }

  private loadUsers(): void {
    this.loading  = true;
    this.apiError = '';
    console.log('[Users] Calling GET /api/users …');
    this.api.getAll().subscribe({
      next: (users) => {
        console.log('[Users] Response OK — received', users.length, 'user(s):', users);
        this.users   = users;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('[Users] Error loading users:', err);
        console.error('[Users] Status:', err?.status, '| Body:', err?.error);
        this.apiError = err?.error?.message ?? `Failed to load users (HTTP ${err?.status ?? 'unknown'}).`;
        this.loading  = false;
        this.cdr.detectChanges();
      },
    });
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  toggleSidebar():  void { this.sidebarOpen = !this.sidebarOpen; }
  logout():         void { this.auth.logout(); this.router.navigate(['/login']); }
  goToDashboard():  void { this.router.navigate(['/dashboard']); }
  goToSimulator():  void { this.router.navigate(['/simulator']); }
  goToProfile():    void { this.router.navigate(['/profile']); }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.closeAddModal();
    this.closeEditModal();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  initials(username: string): string {
    return username.slice(0, 2).toUpperCase();
  }

  avatarUrl(user: UserRecord): string | null {
    return this.api.avatarUrl(user);
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── Add user ──────────────────────────────────────────────────────────────
  openAddModal(): void {
    this.addForm    = { username: '', email: '', password: '', role: 'USER' };
    this.addErrors  = {};
    this.addApiError = '';
    this.showAddModal = true;
  }

  closeAddModal(): void { this.showAddModal = false; }

  submitAdd(): void {
    this.addErrors = this.validateAdd(this.addForm);
    if (Object.keys(this.addErrors).length) return;

    this.addSaving   = true;
    this.addApiError = '';
    this.api.create(this.addForm).subscribe({
      next: (user) => {
        this.users = [...this.users, user];
        this.addSaving = false;
        this.closeAddModal();
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (isDuplicate(err)) {
          swal.error('Already in use', duplicateText(err)).then(() => { this.addSaving = false; this.cdr.detectChanges(); });
        } else if (err?.status === 500) {
          swal.error('Something went wrong', 'Please try again.').then(() => { this.addSaving = false; this.cdr.detectChanges(); });
        } else {
          this.addSaving   = false;
          this.addApiError = err?.error?.message ?? 'Failed to create user.';
          this.cdr.detectChanges();
        }
      },
    });
  }

  private validateAdd(f: CreateUserPayload): FieldErrors {
    const e: FieldErrors = {};
    if (!f.username.trim())          e.username = 'Username is required.';
    else if (f.username.length < 3)  e.username = 'Username must be at least 3 characters.';
    if (!f.email.trim())             e.email    = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Invalid email format.';
    if (!f.password)                 e.password = 'Password is required.';
    else if (f.password.length < 6)  e.password = 'Password must be at least 6 characters.';
    if (!f.role)                     e.role     = 'Role is required.';
    return e;
  }

  // ── Edit user ─────────────────────────────────────────────────────────────
  openEdit(user: UserRecord): void {
    this.editingUser  = user;
    this.editForm     = { username: user.username, email: user.email, role: user.role };
    this.editErrors   = {};
    this.editApiError = '';
  }

  closeEditModal(): void { this.editingUser = null; }

  submitEdit(): void {
    this.editErrors = this.validateEdit(this.editForm);
    if (Object.keys(this.editErrors).length || !this.editingUser) return;

    this.editSaving   = true;
    this.editApiError = '';
    this.api.update(this.editingUser.id, this.editForm).subscribe({
      next: (updated) => {
        this.users      = this.users.map(u => u.id === updated.id ? updated : u);
        this.editSaving = false;
        this.closeEditModal();
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (isDuplicate(err)) {
          swal.error('Already in use', duplicateText(err)).then(() => { this.editSaving = false; this.cdr.detectChanges(); });
        } else if (err?.status === 500) {
          swal.error('Something went wrong', 'Please try again.').then(() => { this.editSaving = false; this.cdr.detectChanges(); });
        } else {
          this.editSaving   = false;
          this.editApiError = err?.error?.message ?? 'Failed to update user.';
          this.cdr.detectChanges();
        }
      },
    });
  }

  private validateEdit(f: UpdateUserPayload): FieldErrors {
    const e: FieldErrors = {};
    if (!f.username.trim())         e.username = 'Username is required.';
    else if (f.username.length < 3) e.username = 'Username must be at least 3 characters.';
    if (!f.email.trim())            e.email    = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Invalid email format.';
    if (!f.role)                    e.role     = 'Role is required.';
    return e;
  }

  // ── Delete user ───────────────────────────────────────────────────────────
  confirmDelete(user: UserRecord): void {
    swal.confirm(
      'Delete user',
      `Are you sure you want to delete "${user.username}"? This action cannot be undone.`,
    ).then(result => {
      if (!result.isConfirmed) return;
      this.api.delete(user.id).subscribe({
        next:  () => { this.users = this.users.filter(u => u.id !== user.id); this.cdr.detectChanges(); },
        error: (err) => {
          if (err?.status === 500) {
            swal.error('Something went wrong', 'Please try again.');
          } else {
            this.apiError = err?.error?.message ?? 'Failed to delete user.';
            this.cdr.detectChanges();
          }
        },
      });
    });
  }
}
