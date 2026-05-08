package com.example.backend.dto.v1;

import com.example.backend.dto.role.RoleResponse;
import com.example.backend.dto.permission.PermissionResponse;

import java.time.Instant;
import java.util.List;

/**
 * Full user details including roles and permissions.
 * Does not expose password_hash.
 */
public record UserDetailResponse(
        String id,
        String email,
        String username,
        String fullName,
        String jobTitle,
        String department,
        String timezone,
        String phone,
        String bio,
        String avatarUrl,
        Boolean isActive,
        Boolean mfaEnabled,
        Boolean verified,
        Instant createdAt,
        List<RoleResponse> roles,
        List<PermissionResponse> permissions
) {
}
