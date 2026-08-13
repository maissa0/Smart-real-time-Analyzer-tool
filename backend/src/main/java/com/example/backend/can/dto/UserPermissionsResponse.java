package com.example.backend.can.dto;

import com.example.backend.dto.permission.PermissionResponse;

import java.util.List;
import java.util.UUID;

public record UserPermissionsResponse(
        UUID userId,
        List<PermissionResponse> rolePermissions,
        List<PermissionResponse> extraPermissions,
        List<PermissionResponse> allPermissions
) {}
