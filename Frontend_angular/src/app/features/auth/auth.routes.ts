import { Route } from '@angular/router';

export const authRoutes: Route[] = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./sign-up/sign-up.component').then((m) => m.SignUpComponent) },
  { path: 'forgot-password', loadComponent: () => import('./forgot-password/forgot-password.component').then((m) => m.ForgotPasswordComponent) },
  { path: 'verify-code', loadComponent: () => import('./code-verification/code-verification.component').then((m) => m.CodeVerificationComponent) },
  { path: 'mfa-verify', loadComponent: () => import('./mfa-verify/mfa-verify.component').then((m) => m.MfaVerifyComponent) },
  { path: 'reset-password', loadComponent: () => import('./reset-password/reset-password.component').then((m) => m.ResetPasswordComponent) },
  { path: '**', redirectTo: 'login' },
];
