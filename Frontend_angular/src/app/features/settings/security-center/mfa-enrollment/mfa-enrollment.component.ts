import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastService } from '../../../../core/services/toast.service';
import { ProfileService } from '../../../../core/services/profile.service';
import { AuthStore } from '../../../../core/store/auth.store';
import QRCode from 'qrcode';

@Component({
  selector: 'app-mfa-enrollment',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './mfa-enrollment.component.html',
  styleUrl: './mfa-enrollment.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfaEnrollmentComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly profileService = inject(ProfileService);
  private readonly authStore = inject(AuthStore);

  readonly isEnrolled = signal(false);
  readonly isEnrolling = signal(false);
  readonly secret = signal('');
  /** Raw otpauth:// URI returned by the backend — not an image URL. */
  readonly otpauthUri = signal('');
  /** Base64 PNG data URL generated client-side from otpauthUri for <img> binding. */
  readonly qrDataUrl = signal('');
  readonly backupCodes = signal<string[]>([]);

  readonly verificationForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly isCodeInvalid = computed(
    () =>
      (this.verificationForm.get('code')?.invalid ?? false) &&
      (this.verificationForm.get('code')?.touched ?? false)
  );

  readonly isDisabling   = signal(false);
  readonly showDisableForm = signal(false);

  readonly disableForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  ngOnInit(): void {
    this.isEnrolled.set(this.authStore.user()?.mfaEnabled ?? false);
  }

  startEnrollment(): void {
    this.isEnrolling.set(true);
    this.verificationForm.reset();
    this.profileService.mfaEnable().subscribe({
      next: (res) => {
        this.secret.set(res.secret);
        this.otpauthUri.set(res.qrCodeUrl);
        QRCode.toDataURL(res.qrCodeUrl, { width: 192, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
          .then(dataUrl => {
            this.qrDataUrl.set(dataUrl);
          })
          .catch(() => {
            this.qrDataUrl.set('');
          });
        this.isEnrolling.set(false);
      },
      error: () => {
        this.isEnrolling.set(false);
      },
    });
  }

  onSubmit(): void {
    if (this.verificationForm.invalid) {
      this.verificationForm.markAllAsTouched();
      return;
    }
    const code = this.verificationForm.getRawValue().code;
    this.profileService.mfaConfirm(code).subscribe({
      next: (res) => {
        this.secret.set('');
        this.otpauthUri.set('');
        this.qrDataUrl.set('');
        this.verificationForm.reset();
        this.backupCodes.set(res.backupCodes ?? []);
        this.isEnrolled.set(true);
        const user = this.authStore.user();
        if (user) {
          this.authStore.updateUser({ ...user, mfaEnabled: true });
        }
        this.toast.success('MFA enabled. Save your backup codes before continuing.');
      },
      error: () => {
        this.toast.error('Invalid verification code. Please try again.');
      },
    });
  }

  cancelEnrollment(): void {
    this.secret.set('');
    this.otpauthUri.set('');
    this.qrDataUrl.set('');
    this.verificationForm.reset();
  }

  disableMfa(): void {
    if (this.disableForm.invalid) {
      this.disableForm.markAllAsTouched();
      return;
    }
    const { password } = this.disableForm.getRawValue();
    this.isDisabling.set(true);
    this.profileService.mfaDisable(password).subscribe({
      next: () => {
        this.isDisabling.set(false);
        this.isEnrolled.set(false);
        this.showDisableForm.set(false);
        this.disableForm.reset();
        const user = this.authStore.user();
        if (user) {
          this.authStore.updateUser({ ...user, mfaEnabled: false });
        }
        this.toast.success('MFA has been disabled.');
      },
      error: () => {
        this.isDisabling.set(false);
        this.toast.error('Incorrect password. MFA was not disabled.');
      },
    });
  }

  confirmBackupCodesSaved(): void {
    this.backupCodes.set([]);
  }

  copyAllCodes(): void {
    const text = this.backupCodes().join('\n');
    navigator.clipboard.writeText(text).then(() => {
      this.toast.success('Backup codes copied to clipboard.');
    });
  }

  downloadCodes(): void {
    const text = this.backupCodes().join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'kpit-mfa-recovery-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  cancelDisable(): void {
    this.showDisableForm.set(false);
    this.disableForm.reset();
  }
}
