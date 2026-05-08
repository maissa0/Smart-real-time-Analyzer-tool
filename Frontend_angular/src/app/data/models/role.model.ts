import type { Permission } from './permission.model';

/**
 * Role model aligned with backend camelCase contract.
 * Section 3.2 of Frontend Integration Guide.
 */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions?: Permission[];
}
