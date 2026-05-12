package com.example.backend.controller.v1;

import com.example.backend.audit.AuditLog;
import com.example.backend.dto.common.PageResponse;
import com.example.backend.dto.user.UserResponse;
import com.example.backend.dto.v1.AssignRoleRequest;
import com.example.backend.dto.v1.*;
import com.example.backend.service.UserServiceV1;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
@Tag(name = "Users V1", description = "User management with filtering, profile, status, password")
public class UserControllerV1 {

    private final UserServiceV1 userService;

    @GetMapping
    @Operation(summary = "List users (paginated, filtered by status, role, search)")
    @PreAuthorize("hasAuthority('user:read') or hasRole('ADMIN')")
    public ResponseEntity<PageResponse<UserResponse>> list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false, defaultValue = "all") String status,
            @RequestParam(required = false) String roleId,
            @RequestParam(required = false, defaultValue = "created_at") String sortBy,
            @RequestParam(required = false, defaultValue = "desc") String sortDirection,
            @RequestParam(required = false, defaultValue = "1") int page,
            @RequestParam(required = false, defaultValue = "10") int size
    ) {
        PageResponse<UserResponse> result = userService.findAll(
                search, status, roleId, sortBy, sortDirection, page, size);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/pending")
    @Operation(summary = "List users pending admin approval")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN') or hasRole('Admin')")
    public ResponseEntity<List<UserResponse>> getPendingUsers() {
        return ResponseEntity.ok(userService.getPendingUsers());
    }

    @PostMapping("/invite")
    @AuditLog(action = "USER_INVITE", resource = "users")
    @Operation(summary = "Admin invites a new user — creates account and sends email")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN') or hasRole('Admin')")
    public ResponseEntity<UserDetailResponse> inviteUser(
            @Valid @RequestBody InviteUserRequest request
    ) {
        UserDetailResponse user = userService.inviteUser(request);
        return ResponseEntity.status(201).body(user);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get full user details including roles and permissions")
    @PreAuthorize("hasAuthority('user:read') or hasRole('ADMIN')")
    public ResponseEntity<UserDetailResponse> getById(@PathVariable UUID id) {
        UserDetailResponse user = userService.findById(id);
        return ResponseEntity.ok(user);
    }

    @PutMapping("/{id}")
    @AuditLog(action = "USER_UPDATE", resource = "users", resourceIdParam = "id")
    @Operation(summary = "Update user profile (fullName, phone, bio)")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN')")
    public ResponseEntity<UserDetailResponse> updateProfile(
            @PathVariable UUID id,
            @Valid @RequestBody UserProfileUpdateRequest request,
            HttpServletRequest httpRequest
    ) {
        UserDetailResponse user = userService.updateProfile(id, request, httpRequest);
        return ResponseEntity.ok(user);
    }

    @PatchMapping("/{id}/status")
    @AuditLog(action = "USER_TOGGLE_STATUS", resource = "users", resourceIdParam = "id")
    @Operation(summary = "Toggle user active status with optional reason")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN')")
    public ResponseEntity<Void> toggleStatus(
            @PathVariable UUID id,
            @RequestBody(required = false) StatusUpdateRequest request,
            HttpServletRequest httpRequest
    ) {
        String reason = request != null ? request.reason() : null;
        userService.toggleStatus(id, reason, httpRequest);
        return ResponseEntity.ok().build();
    }

    @AuditLog(action = "USER_APPROVE", resource = "users", resourceIdParam = "id")
    @PostMapping("/{id}/approve")
    @Operation(summary = "Approve pending user registration or invitation")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN') or hasRole('Admin')")
    public ResponseEntity<Void> approveUser(@PathVariable UUID id) {
        userService.approveUser(id);
        return ResponseEntity.ok().build();
    }

    @AuditLog(action = "USER_REJECT", resource = "users", resourceIdParam = "id")
    @PostMapping("/{id}/reject")
    @Operation(summary = "Reject pending user registration or invitation")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN') or hasRole('Admin')")
    public ResponseEntity<Void> rejectRegistration(
            @PathVariable UUID id,
            @RequestBody(required = false) StatusUpdateRequest request
    ) {
        userService.rejectUser(id, request != null ? request.reason() : null);
        return ResponseEntity.ok().build();
    }

    @AuditLog(action = "USER_ROLE_ASSIGN", resource = "users", resourceIdParam = "id")
    @PatchMapping("/{id}/role")
    @Operation(summary = "Assign a role to a user")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN') or hasRole('Admin')")
    public ResponseEntity<UserDetailResponse> assignRole(
            @PathVariable UUID id,
            @RequestBody AssignRoleRequest request
    ) {
        UserDetailResponse user = userService.assignRole(id, request.roleName());
        return ResponseEntity.ok(user);
    }

    @GetMapping("/{id}/permissions")
    @Operation(summary = "Get all permissions for a user (role + extra)")
    @PreAuthorize("hasAuthority('user:read') or hasRole('ADMIN') or hasRole('Admin')")
    public ResponseEntity<java.util.Map<String, Object>> getUserPermissions(
            @PathVariable UUID id) {
        return ResponseEntity.ok(userService.getUserPermissions(id));
    }

    @AuditLog(action = "USER_PERMISSIONS_UPDATE", resource = "users", resourceIdParam = "id")
    @PutMapping("/{id}/permissions")
    @Operation(summary = "Update extra permissions for a user")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN') or hasRole('Admin')")
    public ResponseEntity<Void> updateUserPermissions(
            @PathVariable UUID id,
            @RequestBody java.util.Map<String, java.util.List<String>> body) {
        userService.updateUserPermissions(id, body.getOrDefault("permissionIds", java.util.List.of()));
        return ResponseEntity.ok().build();
    }

    @PatchMapping("/{id}/password")
    @AuditLog(action = "USER_PASSWORD_CHANGE", resource = "users", resourceIdParam = "id")
    @Operation(summary = "Change user password (verify old, hash new)")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN')")
    public ResponseEntity<Void> changePassword(
            @PathVariable UUID id,
            @Valid @RequestBody PasswordChangeRequest request
    ) {
        userService.changePassword(id, request);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/{id}")
    @AuditLog(action = "USER_DELETE", resource = "users", resourceIdParam = "id")
    @Operation(summary = "Soft-delete a user (sets deleted_at)")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN') or hasRole('Admin')")
    public ResponseEntity<Void> deleteUser(
            @PathVariable UUID id
    ) {
        userService.deleteUser(id);
        return ResponseEntity.noContent().build();
    }
}
