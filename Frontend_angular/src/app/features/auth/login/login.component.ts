import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  NgZone,
  OnInit,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../../core/store/auth.store';
import { AuthService } from '../../../core/services/auth.service';
import { MfaStateService } from '../../../core/services/mfa-state.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  host: {
    style: 'display:block;min-height:100vh;width:100%;',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authStore = inject(AuthStore);
  private readonly authService = inject(AuthService);
  private readonly mfaState = inject(MfaStateService);
  private readonly ngZone = inject(NgZone);

  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly passwordVisible = signal(false);

  private returnUrl = '/admin';

  readonly loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(1)]],
    keepSignedIn: [false],
  });

  togglePasswordVisibility(): void {
    this.passwordVisible.update((v) => !v);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;

    const reason = params['reason'];
    if (reason === 'disabled') {
      this.errorMessage.set('Account Disabled. Contact your administrator.');
    } else if (reason === 'session_expired') {
      this.errorMessage.set('Your session has expired. Please sign in again.');
    }

    const candidate = params['returnUrl'] as string | undefined;
    if (candidate && candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/auth')) {
      this.returnUrl = candidate;
    }
  }

  onSubmit(): void {
    this.errorMessage.set(null);
    if (this.loginForm.invalid) return;

    this.isLoading.set(true);
    const { email, password } = this.loginForm.getRawValue();

    if (!email || !password) return;

    this.authService.login(email, password).subscribe({
      next: (result) => {
        this.ngZone.run(() => {
          if (result.type === 'mfa_required') {
            this.mfaState.setToken(result.data.mfaToken);
            this.mfaState.setReturnUrl(this.returnUrl);
            this.router.navigateByUrl('/auth/mfa-verify');
          } else {
            this.authStore.setAuth({
              user: result.data.user,
              accessToken: result.data.accessToken,
              refreshToken: result.data.refreshToken,
              permissions: result.data.permissions,
            });
            this.router.navigateByUrl(this.returnUrl);
          }
          this.isLoading.set(false);
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.isLoading.set(false);
          // Error message shown by ErrorInterceptor via Toast
          this.errorMessage.set('Invalid email or password. Please try again.');
        });
      },
    });
  }
}
