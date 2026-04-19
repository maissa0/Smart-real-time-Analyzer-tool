import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnInit, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UpdateMePayload, UserApiService, UserRecord } from '../services/user-api.service';
import { swal, isDuplicate, duplicateText } from '../utils/swal';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrl:    './profile.component.css',
})
export class ProfileComponent implements OnInit, OnDestroy {
  private readonly api    = inject(UserApiService);
  private readonly auth   = inject(AuthService);
  private readonly router = inject(Router);
  private readonly cdr    = inject(ChangeDetectorRef);

  sidebarOpen = false;
  isAdmin     = false;

  me:      UserRecord | null = null;
  loading  = true;
  loadErr  = '';

  // ── Per-field inline editing ──────────────────────────────────────────────
  editingField: 'username' | 'email' | null = null;
  fieldDraft   = '';
  fieldError   = '';
  savingField  = false;
  fieldSuccess: 'username' | 'email' | null = null;
  private fieldSuccessTimer?: ReturnType<typeof setTimeout>;

  // ── Password section ──────────────────────────────────────────────────────
  editCurrentPassword = '';
  editNewPassword     = '';
  editConfirmPassword = '';
  showCurrentPw  = false;
  showNewPw      = false;
  showConfirmPw  = false;
  passwordErrors: { newPassword?: string } = {};
  savingPassword  = false;
  passwordSuccess = false;
  passwordError   = '';
  passwordSectionOpen = false;
  private passwordSuccessTimer?: ReturnType<typeof setTimeout>;

  // ── Avatar ────────────────────────────────────────────────────────────────
  avatarUploading = false;
  avatarError     = '';

  // ─────────────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.isAdmin = this.auth.isAdmin();
    this.loadMe();
  }

  ngOnDestroy(): void {
    clearTimeout(this.fieldSuccessTimer);
    clearTimeout(this.passwordSuccessTimer);
  }

  private loadMe(): void {
    this.loading = true;
    this.loadErr = '';
    this.api.getMe().subscribe({
      next: (user) => {
        this.me      = user;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loadErr = err?.error?.message ?? 'Failed to load profile.';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  get username(): string { return this.me?.username ?? this.auth.getCurrentUser() ?? 'user'; }

  get avatarUrl(): string | null {
    return this.me ? this.api.avatarUrl(this.me) : null;
  }

  initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  toggleSidebar():   void { this.sidebarOpen = !this.sidebarOpen; }
  logout():          void { this.auth.logout(); this.router.navigate(['/login']); }
  goToDashboard():   void { this.router.navigate(['/dashboard']); }
  goToSimulator():   void { this.router.navigate(['/simulator']); }
  goToUsers():       void { this.router.navigate(['/users']); }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.editingField) { this.cancelEdit(); return; }
    this.sidebarOpen = false;
  }

  // ── Inline field editing ──────────────────────────────────────────────────
  startEdit(field: 'username' | 'email'): void {
    this.editingField = field;
    this.fieldDraft   = field === 'username' ? (this.me?.username ?? '') : (this.me?.email ?? '');
    this.fieldError   = '';
    this.fieldSuccess = null;
  }

  cancelEdit(): void {
    this.editingField = null;
    this.fieldDraft   = '';
    this.fieldError   = '';
  }

  saveField(): void {
    if (!this.editingField) return;
    this.fieldError = '';

    if (!this.fieldDraft.trim()) {
      this.fieldError = this.editingField === 'username' ? 'Username is required.' : 'Email is required.';
      return;
    }
    if (this.editingField === 'username' && this.fieldDraft.length < 3) {
      this.fieldError = 'At least 3 characters.';
      return;
    }
    if (this.editingField === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.fieldDraft)) {
      this.fieldError = 'Invalid email format.';
      return;
    }

    const field = this.editingField;
    const payload: UpdateMePayload = {
      username:    field === 'username' ? this.fieldDraft : (this.me?.username ?? ''),
      email:       field === 'email'    ? this.fieldDraft : (this.me?.email    ?? ''),
      newPassword: null,
    };

    this.savingField = true;
    this.api.updateMe(payload).subscribe({
      next: (updated) => {
        this.me           = updated;
        this.savingField  = false;
        this.editingField = null;
        this.fieldDraft   = '';
        this.auth.refreshStoredInfo({ username: updated.username, email: updated.email });
        this.fieldSuccess = field;
        this.cdr.detectChanges();
        clearTimeout(this.fieldSuccessTimer);
        this.fieldSuccessTimer = setTimeout(() => {
          this.fieldSuccess = null;
          this.cdr.detectChanges();
        }, 3000);
      },
      error: (err) => {
        if (isDuplicate(err)) {
          swal.error('Already in use', duplicateText(err)).then(() => {
            this.savingField = false;
            this.cdr.detectChanges();
          });
        } else {
          this.savingField = false;
          this.fieldError  = err?.error?.message ?? 'Failed to save.';
          this.cdr.detectChanges();
        }
      },
    });
  }

  // ── Password section ──────────────────────────────────────────────────────
  togglePasswordSection(): void {
    this.passwordSectionOpen = !this.passwordSectionOpen;
    if (!this.passwordSectionOpen) this.resetPasswordForm();
  }

  cancelPassword(): void {
    this.passwordSectionOpen = false;
    this.resetPasswordForm();
  }

  private resetPasswordForm(): void {
    this.editCurrentPassword = '';
    this.editNewPassword     = '';
    this.editConfirmPassword = '';
    this.showCurrentPw  = false;
    this.showNewPw      = false;
    this.showConfirmPw  = false;
    this.passwordErrors = {};
    this.passwordError  = '';
  }

  savePassword(): void {
    this.passwordErrors = {};
    this.passwordError  = '';

    if (!this.editCurrentPassword) {
      swal.error('Current password required', 'Please enter your current password to continue.');
      return;
    }
    if (!this.editNewPassword || this.editNewPassword.length < 6) {
      this.passwordErrors.newPassword = 'New password must be at least 6 characters.';
      return;
    }
    if (this.editNewPassword !== this.editConfirmPassword) {
      swal.error('Passwords do not match', 'The new password and confirmation must be identical.');
      return;
    }

    const payload: UpdateMePayload = {
      username:        this.me?.username ?? '',
      email:           this.me?.email    ?? '',
      currentPassword: this.editCurrentPassword,
      newPassword:     this.editNewPassword,
    };

    this.savingPassword = true;
    this.api.updateMe(payload).subscribe({
      next: () => {
        this.savingPassword = false;
        this.resetPasswordForm();
        this.passwordSectionOpen = false;
        this.passwordSuccess = true;
        this.cdr.detectChanges();
        clearTimeout(this.passwordSuccessTimer);
        this.passwordSuccessTimer = setTimeout(() => {
          this.passwordSuccess = false;
          this.cdr.detectChanges();
        }, 3000);
      },
      error: (err) => {
        this.savingPassword = false;
        if (err?.status === 400) {
          const msg = (err?.error?.message ?? '').toLowerCase();
          const isWrongPw = msg.includes('current') || msg.includes('incorrect')
                         || msg.includes('wrong')   || msg.includes('invalid');
          if (isWrongPw) {
            swal.error('Current password is incorrect',
              'Please check your current password and try again.').then(() => {
              this.cdr.detectChanges();
            });
          } else {
            this.passwordError = err?.error?.message ?? 'Failed to change password.';
            this.cdr.detectChanges();
          }
        } else {
          this.passwordError = err?.error?.message ?? 'Failed to change password.';
          this.cdr.detectChanges();
        }
      },
    });
  }

  // ── Avatar ────────────────────────────────────────────────────────────────
  triggerAvatarInput(input: HTMLInputElement): void { input.click(); }

  onAvatarSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.avatarUploading = true;
    this.avatarError     = '';
    this.api.uploadAvatar(file).subscribe({
      next: (updated) => {
        this.me              = updated;
        this.avatarUploading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.avatarError     = err?.error?.message ?? 'Upload failed.';
        this.avatarUploading = false;
        this.cdr.detectChanges();
      },
    });
  }
}
