package com.example.backend.controller.v1;

import com.example.backend.audit.AuditLog;
import com.example.backend.dto.v1.*;
import com.example.backend.service.RoleService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/roles")
@RequiredArgsConstructor
@Tag(name = "Roles V1", description = "RBAC - roles and permissions")
public class RoleControllerV1 {

    private final RoleService roleService;

    @GetMapping
    @Operation(summary = "List all roles with their permissions")
    @PreAuthorize("hasAuthority('user:read') or hasRole('ADMIN')")
    public ResponseEntity<List<RoleWithPermissionsResponse>> listRoles() {
        List<RoleWithPermissionsResponse> roles = roleService.findAllRolesWithPermissions();
        return ResponseEntity.ok(roles);
    }

    @PutMapping("/{id}/permissions")
    @AuditLog(action = "ROLE_PERMISSIONS_UPDATE", resource = "roles", resourceIdParam = "id")
    @Operation(summary = "Update permission mapping for a role")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<RoleWithPermissionsResponse> updatePermissions(
            @PathVariable UUID id,
            @Valid @RequestBody RolePermissionsUpdateRequest request
    ) {
        RoleWithPermissionsResponse role = roleService.updateRolePermissions(id, request);
        return ResponseEntity.ok(role);
    }
}
