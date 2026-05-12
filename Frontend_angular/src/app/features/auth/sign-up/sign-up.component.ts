import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { API_BASE_URL } from '../../../core/config/api.config';

@Component({
  selector: 'app-sign-up',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, CommonModule],
  templateUrl: './sign-up.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignUpComponent {
  private readonly fb   = inject(FormBuilder);
  private readonly http = inject(HttpClient);

  readonly submitted  = signal(false);
  readonly saving     = signal(false);
  readonly errorMsg   = signal('');

  readonly form = this.fb.nonNullable.group({
    name:     ['', Validators.required],
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMsg.set('');
    const { name, email, password } = this.form.getRawValue();
    this.http.post<{ message?: string }>(
      `${API_BASE_URL}/api/auth/register`,
      { name, email, password }
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this.submitted.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(
          err?.error?.message ?? 'Registration failed. Please try again.'
        );
      },
    });
  }
}
