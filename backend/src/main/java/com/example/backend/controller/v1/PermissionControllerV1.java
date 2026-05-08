package com.example.backend.controller.v1;

import com.example.backend.dto.v1.PermissionSlugResponse;
import com.example.backend.service.RoleService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/permissions")
@RequiredArgsConstructor
@Tag(name = "Permissions V1", description = "RBAC - flat list of permission slugs")
public class PermissionControllerV1 {

    private final RoleService roleService;

    @GetMapping
    @Operation(summary = "List all available permission slugs")
    @PreAuthorize("hasAuthority('user:read') or hasRole('ADMIN')")
    public ResponseEntity<List<PermissionSlugResponse>> listPermissions() {
        List<PermissionSlugResponse> permissions = roleService.findAllPermissionSlugs();
        return ResponseEntity.ok(permissions);
    }
}
