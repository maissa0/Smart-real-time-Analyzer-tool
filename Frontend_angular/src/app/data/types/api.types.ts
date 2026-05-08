/**
 * PageResponse wrapper from backend.
 * Section 4.2 of Frontend Integration Guide.
 */
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

/**
 * ApiError - Standard error response format.
 * Section 5.1 of Frontend Integration Guide.
 */
export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
  status: number;
  path: string;
}
