import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { swal } from '../utils/swal';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.css'
})
export class ResetPasswordComponent {
  form: FormGroup;
  loading = false;
  showPassword = false;
  showConfirm = false;

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      email:           ['', [Validators.required, Validators.email]],
      otp:             ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
      newPassword:     ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required]
    }, { validators: this.passwordsMatch });
  }

  private passwordsMatch(group: AbstractControl) {
    const pw  = group.get('newPassword')?.value;
    const cpw = group.get('confirmPassword')?.value;
    return pw === cpw ? null : { mismatch: true };
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    const { email, otp, newPassword } = this.form.value;
    this.auth.resetPassword(email, otp, newPassword).subscribe({
      next: () => {
        this.loading = false;
        swal.success('Password reset successfully', 'You can now sign in with your new password.')
            .then(() => this.router.navigate(['/login']));
      },
      error: (err) => {
        this.loading = false;
        const msg = err?.error?.message ?? 'Invalid or expired code. Please try again.';
        swal.error('Reset failed', msg);
      }
    });
  }
}
