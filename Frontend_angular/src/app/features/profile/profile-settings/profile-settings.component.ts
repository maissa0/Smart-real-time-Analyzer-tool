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

  readonly activeTab = signal<'profile' | 'password' | 'settings' | 'audit' | 'security'>('profile');

  readonly form = this.fb.nonNullable.group({
    fullName: [''],
    phone:    [''],
    currentPassword: [''],
    newPassword:     [''],
    confirmPassword: [''],
  });

  readonly isSavingProfile = signal(false);
  readonly uploadingAvatar = signal(false);
  readonly avatarPreview   = signal<string | null>(null);
  readonly isChangingPassword = signal(false);

  readonly tabs = [
    { id: 'profile'  as const, label: 'My Profile' },
    { id: 'password' as const, label: 'Change Password' },
    { id: 'settings' as const, label: 'Settings' },
    { id: 'audit'    as const, label: 'Audit Trail' },
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
          phone:    user.phone    ?? '',
        });
        this.authStore.updateUser(user);
      },
      error: () => {},
    });
  }

  saveProfile(): void {
    const { fullName, phone } = this.form.getRawValue();
    this.isSavingProfile.set(true);
    this.profileService.updateMe({ fullName, phone }).subscribe({
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

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (e) => this.avatarPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);

    // Upload to backend
    this.uploadingAvatar.set(true);
    this.profileService.uploadAvatar(file).subscribe({
      next: (res) => {
        this.uploadingAvatar.set(false);
        const user = this.authStore.user();
        if (user) {
          this.authStore.updateUser({ ...user, avatarUrl: res.avatarUrl });
        }
        this.toast.success('Profile picture updated.');
      },
      error: () => {
        this.uploadingAvatar.set(false);
        this.avatarPreview.set(null);
        this.toast.error('Failed to upload image. Max size is 2MB.');
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
