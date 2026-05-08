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
import { AuthStore } from '../../../../store/auth.store';

@Component({
  selector: 'app-mfa-enrollment',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './mfa-enrollment.component.html',
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
  readonly qrCodeUrl = signal('');

  readonly verificationForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly isCodeInvalid = computed(
    () =>
      (this.verificationForm.get('code')?.invalid ?? false) &&
      (this.verificationForm.get('code')?.touched ?? false)
  );

  ngOnInit(): void {
    this.isEnrolled.set(this.authStore.user()?.mfaEnabled ?? false);
  }

  startEnrollment(): void {
    this.isEnrolling.set(true);
    this.verificationForm.reset();
    this.profileService.mfaEnable().subscribe({
      next: (res) => {
        this.secret.set(res.secret);
        this.qrCodeUrl.set(res.qrCodeUrl);
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
        this.isEnrolled.set(true);
        this.secret.set('');
        this.qrCodeUrl.set('');
        this.verificationForm.reset();
        const user = this.authStore.user();
        if (user) {
          this.authStore.updateUser({ ...user, mfaEnabled: true });
        }
        this.toast.success('MFA has been enabled successfully.');
        if (res.backupCodes?.length) {
          this.toast.info('Save your backup codes in a secure place.');
        }
      },
      error: () => {
        this.toast.error('Invalid verification code. Please try again.');
      },
    });
  }

  cancelEnrollment(): void {
    this.secret.set('');
    this.qrCodeUrl.set('');
    this.verificationForm.reset();
  }
}
