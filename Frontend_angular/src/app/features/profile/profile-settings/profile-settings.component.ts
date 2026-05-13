import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { AuthStore } from '../../../store/auth.store';
import { BreadcrumbComponent } from '../../../shared/components/breadcrumb/breadcrumb.component';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { ProfileService } from '../../../core/services/profile.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuditLogComponent } from '../../settings/audit-log/audit-log.component';
import { SecurityCenterComponent } from '../../settings/security-center/security-center.component';

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [ReactiveFormsModule, BreadcrumbComponent, DatePipe, AuditLogComponent, SecurityCenterComponent],
  templateUrl: './profile-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileSettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  readonly authStore = inject(AuthStore);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly profileService = inject(ProfileService);
  private readonly toast = inject(ToastService);

  readonly activeTab = signal<'profile' | 'personal' | 'account' | 'password' | 'settings' | 'audit' | 'security'>('profile');

  readonly form = this.fb.nonNullable.group({
    fullName: [''],
    username: [''],
    email: [''],
    phone: [''],
    jobTitle: [''],
    department: [''],
    timezone: [''],
    bio: [''],
    currentPassword: [''],
    newPassword: [''],
    confirmPassword: [''],
  });

  readonly isSavingProfile = signal(false);
  readonly isChangingPassword = signal(false);

  readonly tabs = [
    { id: 'profile' as const, label: 'Profile' },
    { id: 'personal' as const, label: 'Personal' },
    { id: 'account' as const, label: 'My Account' },
    { id: 'password' as const, label: 'Change Password' },
    { id: 'settings' as const, label: 'Settings' },
    { id: 'audit' as const, label: 'Audit Trail' },
    { id: 'security' as const, label: 'Security Center' },
  ];

  readonly primaryRole = () => this.authStore.user()?.roles?.[0]?.name ?? 'User';

  ngOnInit(): void {
    this.breadcrumb.set([
      { label: 'Home', url: '/admin' },
      { label: 'Profile', url: '/admin/profile' },
    ]);
    this.loadProfile();
  }

  private loadProfile(): void {
    this.profileService.getMe().subscribe({
      next: (user) => {
        this.form.patchValue({
          fullName: user.fullName ?? '',
          username: user.username,
          email: user.email,
          phone: user.phone ?? '',
          jobTitle: user.jobTitle ?? '',
          department: user.department ?? '',
          timezone: user.timezone ?? '',
          bio: user.bio ?? '',
        });
        this.authStore.updateUser(user);
      },
      error: () => {},
    });
  }

  saveProfile(): void {
    const { fullName, timezone, phone, bio } = this.form.getRawValue();
    this.isSavingProfile.set(true);
    this.profileService.updateMe({ fullName, timezone, phone, bio }).subscribe({
      next: (user) => {
        this.authStore.updateUser(user);
        this.isSavingProfile.set(false);
        this.toast.success('Profile updated successfully.');
      },
      error: () => {
        this.isSavingProfile.set(false);
      },
    });
  }

  changePassword(): void {
    const { currentPassword, newPassword } = this.form.getRawValue();
    if (!currentPassword || !newPassword) return;
    this.isChangingPassword.set(true);
    this.profileService.changePassword(currentPassword, newPassword).subscribe({
      next: () => {
        this.form.patchValue({ currentPassword: '', newPassword: '', confirmPassword: '' });
        this.isChangingPassword.set(false);
        this.toast.success('Password changed successfully.');
      },
      error: () => {
        this.isChangingPassword.set(false);
      },
    });
  }

  setTab(tab: (typeof this.tabs)[0]['id']): void {
    this.activeTab.set(tab);
    if (tab === 'audit') {
      this.breadcrumb.set([{ label: 'Home', url: '/admin' }, { label: 'Profile', url: '/admin/profile' }, { label: 'Audit Trail' }]);
    } else if (tab === 'security') {
      this.breadcrumb.set([{ label: 'Home', url: '/admin' }, { label: 'Profile', url: '/admin/profile' }, { label: 'Security Center' }]);
    } else {
      this.breadcrumb.set([{ label: 'Home', url: '/admin' }, { label: 'Profile', url: '/admin/profile' }]);
    }
  }
}
