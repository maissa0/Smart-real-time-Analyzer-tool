package com.example.backend.dto.v1;

import com.example.backend.dto.permission.PermissionResponse;

import java.util.List;

/**
 * Role with its associated permissions.
 */
public record RoleWithPermissionsResponse(
        String id,
        String name,
        String description,
        List<PermissionResponse> permissions
) {
}
