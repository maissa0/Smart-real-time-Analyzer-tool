/**
 * AuditLog model aligned with backend camelCase contract.
 * Section 3.5 of Frontend Integration Guide.
 */
export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  source: 'audit' | 'security';
  createdAt: string;
}

/**
 * Session model for active sessions.
 * Section 3.4 of Frontend Integration Guide.
 */
export interface Session {
  id: string;
  device: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastActive: string;
  createdAt: string;
}
