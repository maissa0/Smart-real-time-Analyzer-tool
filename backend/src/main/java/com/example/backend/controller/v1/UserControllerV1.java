package com.example.backend.controller.v1;

import com.example.backend.audit.AuditLog;
import com.example.backend.dto.common.PageResponse;
import com.example.backend.dto.user.UserResponse;
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
    @Operation(summary = "Toggle user is_active status")
    @PreAuthorize("hasAuthority('user:write') or hasRole('ADMIN')")
    public ResponseEntity<Void> toggleStatus(
            @PathVariable UUID id,
            HttpServletRequest httpRequest
    ) {
        userService.toggleStatus(id, httpRequest);
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
}
