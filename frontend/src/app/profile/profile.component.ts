import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnInit, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import QRCode from 'qrcode';
import { AuthService } from '../services/auth.service';
import { DashboardStateService } from '../services/dashboard-state.service';
import { UpdateMePayload, UploadRecord, UserApiService, UserRecord, SessionRecord,
         AuditLogRecord, AuditPage } from '../services/user-api.service';
import { swal, isDuplicate, duplicateText } from '../utils/swal';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrl:    './profile.component.css',
})
export class ProfileComponent implements OnInit, OnDestroy {
  private readonly api       = inject(UserApiService);
  private readonly auth      = inject(AuthService);
  private readonly router    = inject(Router);
  private readonly cdr       = inject(ChangeDetectorRef);
  private readonly dashState = inject(DashboardStateService);

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

  // ── Uploads section ───────────────────────────────────────────────────────
  uploads:        UploadRecord[] = [];
  uploadsLoading  = false;
  uploadsError    = '';
  reanalyzing: { [id: number]: boolean } = {};
  reanalysisError: { [id: number]: string } = {};

  // ── Audit log section ─────────────────────────────────────────────────────
  auditSectionOpen  = false;
  auditTab: 'mine' | 'all' = 'mine';
  auditLogs:        AuditLogRecord[] = [];
  auditPage         = 0;
  auditTotalPages   = 0;
  auditTotalElements = 0;
  auditLoading      = false;
  auditError        = '';

  // ── Sessions section ──────────────────────────────────────────────────────
  sessionsSectionOpen = false;
  sessions:        SessionRecord[] = [];
  sessionsLoading  = false;
  sessionsError    = '';
  revokingSession: { [id: number]: boolean } = {};
  revokingOthers   = false;

  // ── MFA section ───────────────────────────────────────────────────────────
  mfaSectionOpen  = false;
  mfaStep: 'idle' | 'enabling' | 'disabling' = 'idle';
  mfaSetupSecret  = '';
  mfaQrDataUrl: string | null = null;
  mfaCode         = '';
  mfaDisablePw    = '';
  mfaDisableCode  = '';
  mfaError        = '';
  mfaSuccess      = false;
  mfaSaving       = false;
  private mfaSuccessTimer?: ReturnType<typeof setTimeout>;

  // ─────────────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.isAdmin = this.auth.isAdmin();
    this.loadMe();
    this.loadUploads();
  }

  ngOnDestroy(): void {
    clearTimeout(this.fieldSuccessTimer);
    clearTimeout(this.passwordSuccessTimer);
    clearTimeout(this.mfaSuccessTimer);
  }

  private loadMe(): void {
    this.loading = true;
    this.loadErr = '';
    console.log('[Profile] Calling GET /api/users/me …');
    this.api.getMe().subscribe({
      next: (user) => {
        console.log('[Profile] Response OK:', user);
        this.me      = user;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('[Profile] Error loading profile:', err);
        console.error('[Profile] Status:', err?.status, '| Body:', err?.error);
        this.loadErr = err?.error?.message ?? `Failed to load profile (HTTP ${err?.status ?? 'unknown'}).`;
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
        this.passwordError  = err?.error?.message
                           ?? (typeof err?.error === 'string' ? err.error : null)
                           ?? 'Failed to change password.';
        this.cdr.detectChanges();
      },
    });
  }

  // ── Uploads ───────────────────────────────────────────────────────────────
  private loadUploads(): void {
    this.uploadsLoading = true;
    this.uploadsError   = '';
    this.api.getMyUploads().subscribe({
      next: (list) => {
        this.uploads        = list;
        this.uploadsLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.uploadsError   = err?.error?.message ?? 'Failed to load uploads.';
        this.uploadsLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  reanalyze(upload: UploadRecord): void {
    this.reanalyzing[upload.id]     = true;
    this.reanalysisError[upload.id] = '';
    this.api.reanalyzeUpload(upload.id).subscribe({
      next: (result) => {
        this.reanalyzing[upload.id] = false;
        this.dashState.pendingResult = {
          frames:       result.frames       ?? [],
          errorReport:  result.errorReport  ?? null,
          xmlFilesUsed: result.xmlFilesUsed ?? [],
        };
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.reanalyzing[upload.id]     = false;
        this.reanalysisError[upload.id] = err?.error?.error ?? 'Re-analysis failed.';
        this.cdr.detectChanges();
      },
    });
  }

  formatUploadDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ── Audit log ────────────────────────────────────────────────────────────
  toggleAuditSection(): void {
    this.auditSectionOpen = !this.auditSectionOpen;
    if (this.auditSectionOpen && this.auditLogs.length === 0) this.loadAudit();
  }

  switchAuditTab(tab: 'mine' | 'all'): void {
    if (this.auditTab === tab) return;
    this.auditTab  = tab;
    this.auditPage = 0;
    this.auditLogs = [];
    this.loadAudit();
  }

  loadAudit(): void {
    this.auditLoading = true;
    this.auditError   = '';
    const obs = this.auditTab === 'all'
        ? this.api.getAllAuditLogs(this.auditPage)
        : this.api.getMyAuditLogs(this.auditPage);
    obs.subscribe({
      next: (res: AuditPage) => {
        this.auditLogs         = res.content;
        this.auditTotalPages   = res.totalPages;
        this.auditTotalElements = res.totalElements;
        this.auditLoading      = false;
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.auditError   = err?.error?.message ?? 'Failed to load activity log.';
        this.auditLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  auditPrev(): void { if (this.auditPage > 0) { this.auditPage--; this.loadAudit(); } }
  auditNext(): void { if (this.auditPage < this.auditTotalPages - 1) { this.auditPage++; this.loadAudit(); } }

  auditActionColor(action: string): string {
    if (!action) return '';
    const a = action.toUpperCase();
    if (a.startsWith('LOGIN') || a === 'LOGOUT' || a === 'REGISTER') return 'audit-blue';
    if (a.includes('FILE') || a.includes('ANALY')) return 'audit-green';
    if (a.includes('MFA') || a.includes('PASSWORD') || a.includes('SESSION')) return 'audit-orange';
    if (a.includes('USER_CREATED') || a.includes('USER_UPDATED') || a.includes('USER_DELETED')) return 'audit-red';
    return '';
  }

  auditActionLabel(action: string): string {
    const labels: Record<string, string> = {
      LOGIN:              'Login',
      LOGIN_MFA:          'Login (MFA)',
      LOGOUT:             'Logout',
      REGISTER:           'Register',
      PASSWORD_CHANGED:   'Password changed',
      PASSWORD_RESET:     'Password reset',
      MFA_ENABLED:        'MFA enabled',
      MFA_DISABLED:       'MFA disabled',
      FILE_ANALYZED:      'File analyzed',
      SESSION_REVOKED:    'Session revoked',
      SESSIONS_REVOKED_ALL: 'All sessions revoked',
      USER_CREATED:       'User created',
      USER_UPDATED:       'User updated',
      USER_DELETED:       'User deleted',
    };
    return labels[action] ?? action;
  }

  // ── Sessions ─────────────────────────────────────────────────────────────
  toggleSessionsSection(): void {
    this.sessionsSectionOpen = !this.sessionsSectionOpen;
    if (this.sessionsSectionOpen && this.sessions.length === 0) this.loadSessions();
  }

  private loadSessions(): void {
    this.sessionsLoading = true;
    this.sessionsError   = '';
    this.api.getSessions().subscribe({
      next: (list) => {
        this.sessions        = list;
        this.sessionsLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.sessionsError   = err?.error?.message ?? 'Failed to load sessions.';
        this.sessionsLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  revokeSession(session: SessionRecord): void {
    if (session.isCurrent) return;
    swal.confirm('Revoke session?', 'This device will be signed out immediately.').then((res) => {
      if (!res.isConfirmed) return;
      this.revokingSession[session.id] = true;
      this.api.revokeSession(session.id).subscribe({
        next: () => {
          this.revokingSession[session.id] = false;
          this.sessions = this.sessions.filter(s => s.id !== session.id);
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.revokingSession[session.id] = false;
          swal.error('Failed', err?.error?.message ?? 'Could not revoke session.');
          this.cdr.detectChanges();
        },
      });
    });
  }

  revokeAllOtherSessions(): void {
    swal.confirm('Revoke all other sessions?', 'All other devices will be signed out immediately.').then((res) => {
      if (!res.isConfirmed) return;
      this.revokingOthers = true;
      this.api.revokeAllOtherSessions().subscribe({
        next: () => {
          this.revokingOthers = false;
          this.loadSessions();
        },
        error: (err) => {
          this.revokingOthers = false;
          swal.error('Failed', err?.error?.message ?? 'Could not revoke sessions.');
          this.cdr.detectChanges();
        },
      });
    });
  }

  parseDevice(userAgent: string): string {
    if (!userAgent) return 'Unknown device';
    const ua = userAgent.toLowerCase();
    let browser = 'Browser';
    let os = '';
    if (ua.includes('firefox'))        browser = 'Firefox';
    else if (ua.includes('edg/'))      browser = 'Edge';
    else if (ua.includes('chrome'))    browser = 'Chrome';
    else if (ua.includes('safari'))    browser = 'Safari';
    else if (ua.includes('opera'))     browser = 'Opera';
    else if (ua.includes('curl'))      browser = 'curl';
    else if (ua.includes('postman'))   browser = 'Postman';

    if (ua.includes('windows'))        os = 'Windows';
    else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
    else if (ua.includes('android'))   os = 'Android';
    else if (ua.includes('iphone'))    os = 'iPhone';
    else if (ua.includes('ipad'))      os = 'iPad';
    else if (ua.includes('linux'))     os = 'Linux';

    return os ? `${browser} on ${os}` : browser;
  }

  formatRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff / 60000);
    if (mins < 1)   return 'Just now';
    if (mins < 60)  return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days  = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // ── MFA ───────────────────────────────────────────────────────────────────
  toggleMfaSection(): void {
    this.mfaSectionOpen = !this.mfaSectionOpen;
    if (!this.mfaSectionOpen) this.resetMfa();
  }

  startMfaEnable(): void {
    this.mfaError = '';
    this.mfaStep  = 'enabling';
    this.api.mfaSetup().subscribe({
      next: async (res) => {
        this.mfaSetupSecret = res.secret;
        this.mfaQrDataUrl   = await QRCode.toDataURL(res.qrCodeUrl);
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.mfaError = err?.error?.message ?? 'Setup failed.';
        this.mfaStep  = 'idle';
        this.cdr.detectChanges();
      },
    });
  }

  confirmMfaEnable(): void {
    if (!this.mfaCode || this.mfaCode.length !== 6) {
      this.mfaError = 'Enter the 6-digit code from your authenticator app.';
      return;
    }
    this.mfaSaving = true;
    this.mfaError  = '';
    this.api.mfaEnable(this.mfaCode).subscribe({
      next: () => {
        if (this.me) this.me = { ...this.me, mfaEnabled: true };
        this.mfaSaving = false;
        this.mfaStep   = 'idle';
        this.mfaSuccess = true;
        this.cdr.detectChanges();
        clearTimeout(this.mfaSuccessTimer);
        this.mfaSuccessTimer = setTimeout(() => {
          this.mfaSuccess = false;
          this.cdr.detectChanges();
        }, 3000);
      },
      error: (err) => {
        this.mfaSaving = false;
        this.mfaError  = err?.error?.message ?? 'Invalid code.';
        this.cdr.detectChanges();
      },
    });
  }

  startMfaDisable(): void {
    this.mfaError = '';
    this.mfaStep  = 'disabling';
  }

  confirmMfaDisable(): void {
    if (!this.mfaDisablePw) {
      this.mfaError = 'Password is required.';
      return;
    }
    if (!this.mfaDisableCode || this.mfaDisableCode.length !== 6) {
      this.mfaError = 'Enter the 6-digit code from your authenticator app.';
      return;
    }
    this.mfaSaving = true;
    this.mfaError  = '';
    this.api.mfaDisable(this.mfaDisablePw, this.mfaDisableCode).subscribe({
      next: () => {
        if (this.me) this.me = { ...this.me, mfaEnabled: false };
        this.mfaSaving = false;
        this.mfaStep   = 'idle';
        this.mfaSuccess = true;
        this.cdr.detectChanges();
        clearTimeout(this.mfaSuccessTimer);
        this.mfaSuccessTimer = setTimeout(() => {
          this.mfaSuccess = false;
          this.cdr.detectChanges();
        }, 3000);
      },
      error: (err) => {
        this.mfaSaving = false;
        this.mfaError  = err?.error?.message ?? 'Failed to disable 2FA.';
        this.cdr.detectChanges();
      },
    });
  }

  cancelMfa(): void { this.resetMfa(); this.mfaStep = 'idle'; }

  private resetMfa(): void {
    this.mfaStep        = 'idle';
    this.mfaSetupSecret = '';
    this.mfaQrDataUrl   = null;
    this.mfaCode        = '';
    this.mfaDisablePw   = '';
    this.mfaDisableCode = '';
    this.mfaError       = '';
    this.mfaSaving      = false;
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
