/**
 * Permission model aligned with backend camelCase contract.
 * Section 3.3 of Frontend Integration Guide.
 */
export interface Permission {
  id: string;
  slug: string;
  description: string | null;
}
