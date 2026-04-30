import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { swal } from '../utils/swal';

@Component({
  selector: 'app-mfa-verify',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './mfa-verify.component.html',
  styleUrl: './mfa-verify.component.css',
})
export class MfaVerifyComponent implements OnInit {
  form: FormGroup;
  loading = false;
  error   = '';

  constructor(
    private fb:     FormBuilder,
    private auth:   AuthService,
    private router: Router,
    private cdr:    ChangeDetectorRef,
  ) {
    this.form = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });
  }

  ngOnInit(): void {
    if (!sessionStorage.getItem('mfa_token')) {
      this.router.navigate(['/login']);
    }
  }

  submit(): void {
    if (this.form.invalid) return;
    this.loading = true;
    this.error   = '';
    const mfaToken = sessionStorage.getItem('mfa_token') ?? '';
    const code     = this.form.value.code as string;

    this.auth.mfaVerify(mfaToken, code).subscribe({
      next: () => {
        sessionStorage.removeItem('mfa_token');
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message ?? 'Invalid code. Please try again.';
        this.cdr.detectChanges();
      },
    });
  }

  back(): void {
    sessionStorage.removeItem('mfa_token');
    this.router.navigate(['/login']);
  }
}
