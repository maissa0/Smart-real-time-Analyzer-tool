import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { swal, isDuplicate, duplicateText } from '../utils/swal';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  form: FormGroup;
  loading = false;
  success = '';
  showPassword = false;

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router, private cdr: ChangeDetectorRef) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]]
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.success = '';
    const { username, email, password } = this.form.value;

    this.auth.register(username, email, password).subscribe({
      next: () => {
        this.loading = false;
        this.success = '✅ Account created! Logging you in…';
        // Call login immediately — the HTTP round-trip naturally keeps the
        // success message visible for ~100-300ms before navigation.
        this.auth.login(username, password).subscribe({
          next: () => this.router.navigate(['/dashboard']),
          error: () => this.router.navigate(['/login'])
        });
      },
      error: (err) => {
        const popup = isDuplicate(err)
          ? swal.error('Already in use', duplicateText(err))
          : err?.status === 500
            ? swal.error('Something went wrong', 'Please try again.')
            : swal.error('Registration failed', err?.error?.message || 'Please try again.');
        popup.then(() => { this.loading = false; this.cdr.detectChanges(); });
      }
    });
  }
}