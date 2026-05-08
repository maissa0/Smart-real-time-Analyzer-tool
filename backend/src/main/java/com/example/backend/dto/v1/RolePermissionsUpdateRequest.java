package com.example.backend.dto.v1;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * Request to update role's permission mapping.
 */
public record RolePermissionsUpdateRequest(
        @NotNull List<String> permissionIds
) {
}
