import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../../../core/config/api.config';

@Component({
  selector: 'app-set-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .sp-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #07090b;
      padding: 1rem;
    }
    .sp-card {
      width: 100%;
      max-width: 420px;
      background: #0d1117;
      border: 1px solid rgba(176,255,68,0.2);
      border-radius: 12px;
      padding: 2rem;
    }
    .sp-logo {
      font-size: 1.1rem;
      font-weight: 800;
      color: #b0ff44;
      letter-spacing: 0.08em;
      margin-bottom: 0.25rem;
    }
    .sp-subtitle {
      font-size: 0.75rem;
      color: #8a9ab0;
      margin-bottom: 2rem;
    }
    .sp-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    .sp-desc {
      font-size: 0.78rem;
      color: #8a9ab0;
      margin-bottom: 1.5rem;
    }
    .sp-label {
      display: block;
      font-size: 0.72rem;
      font-weight: 600;
      color: #8a9ab0;
      letter-spacing: 0.05em;
      margin-bottom: 0.35rem;
    }
    .sp-input {
      width: 100%;
      background: #161b22;
      border: 1px solid rgba(176,255,68,0.2);
      border-radius: 6px;
      color: #e6edf3;
      font-size: 0.85rem;
      padding: 10px 12px;
      outline: none;
      box-sizing: border-box;
      margin-bottom: 1rem;
    }
    .sp-input:focus { border-color: rgba(176,255,68,0.5); }
    .sp-input.error { border-color: #ff4444; }
    .sp-error { font-size: 0.7rem; color: #ff4444; margin: -0.75rem 0 0.75rem; }
    .sp-btn {
      width: 100%;
      background: #b0ff44;
      color: #07090b;
      border: none;
      border-radius: 8px;
      padding: 11px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      margin-top: 0.5rem;
      transition: opacity 0.2s;
    }
    .sp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .sp-success {
      text-align: center;
      padding: 1rem 0;
    }
    .sp-success-icon { font-size: 3rem; margin-bottom: 1rem; }
    .sp-success h3 { color: #b0ff44; font-size: 1.1rem; margin-bottom: 0.5rem; }
    .sp-success p { color: #8a9ab0; font-size: 0.82rem; margin-bottom: 1.5rem; }
    .sp-login-btn {
      display: inline-block;
      background: #b0ff44;
      color: #07090b;
      border: none;
      border-radius: 8px;
      padding: 10px 28px;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
    }
    .sp-expired {
      text-align: center;
      padding: 1rem 0;
    }
    .sp-expired-icon { font-size: 3rem; margin-bottom: 1rem; }
    .sp-expired h3 { color: #ff4444; font-size: 1rem; margin-bottom: 0.5rem; }
    .sp-expired p { color: #8a9ab0; font-size: 0.82rem; }
  `],
  template: `
    <div class="sp-wrap">
      <div class="sp-card">
        <div class="sp-logo">KPIT ANALYSER</div>
        <div class="sp-subtitle">Smart Real-Time CAN Bus Analysis Platform</div>

        @if (success()) {
          <div class="sp-success">
            <div class="sp-success-icon">✅</div>
            <h3>Password set successfully!</h3>
            <p>Your account is now active. You can log in with your email and new password.</p>
            <button class="sp-login-btn" (click)="goToLogin()">Go to Login</button>
          </div>
        } @else if (tokenMissing()) {
          <div class="sp-expired">
            <div class="sp-expired-icon">⚠️</div>
            <h3>Invalid or expired link</h3>
            <p>This invitation link is invalid or has expired (15 min limit).<br>
               Please ask your administrator to resend the invitation.</p>
          </div>
        } @else {
          <h2 class="sp-title">Set your password</h2>
          <p class="sp-desc">Welcome to KPIT Smart CAN Analyser. Choose a password to activate your account.</p>

          <form [formGroup]="form" (ngSubmit)="onSubmit()">
            <label class="sp-label">NEW PASSWORD</label>
            <input type="password" formControlName="password"
              placeholder="Min. 8 characters"
              [class]="'sp-input' + (form.get('password')?.invalid && form.get('password')?.touched ? ' error' : '')"/>
            @if (form.get('password')?.invalid && form.get('password')?.touched) {
              <p class="sp-error">Password must be at least 8 characters</p>
            }

            <label class="sp-label">CONFIRM PASSWORD</label>
            <input type="password" formControlName="confirm"
              placeholder="Repeat your password"
              [class]="'sp-input' + (form.hasError('mismatch') && form.get('confirm')?.touched ? ' error' : '')"/>
            @if (form.hasError('mismatch') && form.get('confirm')?.touched) {
              <p class="sp-error">Passwords do not match</p>
            }

            @if (serverError()) {
              <p class="sp-error" style="margin-bottom:0.75rem;">{{ serverError() }}</p>
            }

            <button type="submit" class="sp-btn"
              [disabled]="form.invalid || saving()">
              {{ saving() ? 'Setting password…' : 'Set Password & Activate Account' }}
            </button>
          </form>
        }
      </div>
    </div>
  `,
})
export class SetPasswordComponent implements OnInit {
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http   = inject(HttpClient);
  private readonly fb     = inject(FormBuilder);

  readonly success      = signal(false);
  readonly saving       = signal(false);
  readonly tokenMissing = signal(false);
  readonly serverError  = signal('');

  private token = '';

  readonly form = this.fb.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirm:  ['', Validators.required],
    },
    { validators: this.passwordMatchValidator }
  );

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.tokenMissing.set(true);
    }
  }

  onSubmit(): void {
    if (this.form.invalid || !this.token) return;
    this.saving.set(true);
    this.serverError.set('');

    const { password } = this.form.getRawValue();
    this.http.post(
      `${API_BASE_URL}/api/auth/set-password`,
      { resetToken: this.token, newPassword: password }
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.serverError.set(
          err?.error?.message ?? 'Link expired or invalid. Ask your admin to resend.'
        );
      },
    });
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirm  = control.get('confirm')?.value;
    return password && confirm && password !== confirm
      ? { mismatch: true }
      : null;
  }
}
