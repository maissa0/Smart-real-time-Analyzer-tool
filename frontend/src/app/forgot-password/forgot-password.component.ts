import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.css'
})
export class ForgotPasswordComponent {
  form: FormGroup;
  loading = false;
  submitted = false;

  constructor(private fb: FormBuilder, private auth: AuthService) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.auth.forgotPassword(this.form.value.email).subscribe({
      next: () => {
        this.loading = false;
        this.submitted = true;
      },
      error: () => {
        // Always show the success message to avoid email enumeration
        this.loading = false;
        this.submitted = true;
      }
    });
  }
}
