package com.example.backend.dto.v1;

/**
 * Flat permission slug for RBAC.
 */
public record PermissionSlugResponse(
        String id,
        String slug,
        String description
) {
}
