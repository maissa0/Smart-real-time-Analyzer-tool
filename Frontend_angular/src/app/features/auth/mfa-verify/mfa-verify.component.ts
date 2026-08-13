import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AuthStore } from '../../../core/store/auth.store';
import { MfaStateService } from '../../../core/services/mfa-state.service';

@Component({
  selector: 'app-mfa-verify',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="auth-page-bg px-4">
      <div class="w-full max-w-md">
        <div
          class="auth-card p-8 shadow-able-card"
          style="box-shadow: 0 0 24px rgba(176, 255, 68, 0.08)"
        >
          <div class="mb-6 text-center">
            <h1 class="text-2xl font-bold" style="color: #b0ff44">
              KPIT <span class="text-sm align-super" style="color: #fff">Analyser</span>
            </h1>
          </div>
          <h2 class="mb-2 text-xl font-semibold text-white">Two-Factor Authentication</h2>
          <p class="mb-6 text-sm" style="color: #8a9ab0">Enter the 6-digit code from your authenticator app.</p>
          @if (errorMessage()) {
            <p class="mb-4 text-sm" style="color: #ff6b6b">{{ errorMessage() }}</p>
          }
          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-4">
            <input
              type="text"
              inputmode="numeric"
              maxlength="6"
              formControlName="code"
              placeholder="000000"
              class="auth-input w-full px-4 py-2.5 text-center text-lg tracking-[0.5em]"
            />
            <button type="submit" [disabled]="form.invalid || isSubmitting()" class="auth-btn-primary w-full px-4 py-2.5 font-medium">
              @if (isSubmitting()) {
                Verifying...
              } @else {
                Verify
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfaVerifyComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly mfaState = inject(MfaStateService);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  onSubmit(): void {
    this.errorMessage.set(null);
    const token = this.mfaState.getToken();
    if (!token) {
      this.errorMessage.set('Session expired. Please sign in again.');
      this.router.navigateByUrl('/auth/login');
      return;
    }
    const code = this.form.getRawValue().code;
    this.isSubmitting.set(true);
    this.authService.mfaVerify(token, code).subscribe({
      next: (res) => {
        const returnUrl = this.mfaState.getReturnUrl() ?? '/admin';
        this.mfaState.clear();
        this.authStore.setAuth({
          user: res.user,
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          permissions: res.permissions,
        });
        this.router.navigateByUrl(returnUrl);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.error?.message ?? 'Invalid code. Please try again.');
      },
    });
  }
}
