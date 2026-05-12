package com.example.backend.dto.v1;

public record AssignRoleRequest(
        /** Role name as stored in DB — "Admin" or "User" */
        String roleName
) {}
