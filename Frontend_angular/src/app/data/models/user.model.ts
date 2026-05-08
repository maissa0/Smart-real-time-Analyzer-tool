import type { Role } from './role.model';

/**
 * User model aligned with backend camelCase contract.
 * Section 3.1 of Frontend Integration Guide.
 */
export interface User {
  id: string;
  email: string;
  username: string;
  fullName: string | null;
  jobTitle: string | null;
  department: string | null;
  timezone: string | null;
  phone: string | null;
  bio: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  mfaEnabled: boolean;
  verified: boolean;
  createdAt: string;
  roles?: Role[];
  permissions?: import('./permission.model').Permission[];
}
