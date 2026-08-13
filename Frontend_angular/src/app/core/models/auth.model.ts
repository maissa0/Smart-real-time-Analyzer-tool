import type { User } from './user.model';
import type { Permission } from './permission.model';

/**
 * AuthResponse - 200 OK from login, register, refresh, MFA verify.
 * Section 1.1.1 of Frontend Integration Guide.
 */
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  permissions: Permission[];
}

/**
 * MfaAuthResponse - 202 Accepted when MFA is required.
 * Section 2 of Frontend Integration Guide.
 */
export interface MfaAuthResponse {
  mfaRequired: boolean;
  mfaToken: string;
}
