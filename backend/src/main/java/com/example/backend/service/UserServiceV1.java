package com.example.backend.service;

import com.example.backend.can.dto.UserPermissionsResponse;
import com.example.backend.dto.common.PageResponse;
import com.example.backend.dto.permission.PermissionResponse;
import com.example.backend.dto.user.UserResponse;
import com.example.backend.dto.v1.*;
import com.example.backend.entity.PermissionEntity;
import com.example.backend.entity.RoleEntity;
import com.example.backend.entity.UserEntity;
import com.example.backend.exception.ConflictException;
import com.example.backend.exception.ResourceNotFoundException;
import com.example.backend.mapper.UserMapper;
import com.example.backend.repository.PermissionRepository;
import com.example.backend.repository.RoleRepository;
import com.example.backend.repository.UserRepository;
import com.example.backend.security.JwtService;
import com.example.backend.specification.UserSpecification;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class UserServiceV1 {

    private final UserRepository userRepository;
    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final EmailService emailService;
    private final JwtService jwtService;

    @Value("${app.frontend-url}")
    private String frontendUrl;

    @Transactional(readOnly = true)
    public PageResponse<UserResponse> findAll(String search, String status, String roleId,
                                               String sortBy, String sortDirection, int page, int size) {
        Boolean isActive = parseStatus(status);
        UUID roleUuid = roleId != null && !roleId.isBlank() ? UUID.fromString(roleId) : null;

        Specification<UserEntity> spec = UserSpecification.withFilters(search, isActive, roleUuid);
        String sortProperty = mapSortField(sortBy);
        Sort sort = "asc".equalsIgnoreCase(sortDirection)
                ? Sort.by(sortProperty).ascending()
                : Sort.by(sortProperty).descending();
        int pageIndex = Math.max(0, page - 1);
        Pageable pageable = PageRequest.of(pageIndex, size, sort);

        Page<UserEntity> result = userRepository.findAll(spec, pageable);
        List<UserResponse> content = result.getContent().stream()
                .map(userMapper::toResponse)
                .collect(Collectors.toList());

        return PageResponse.<UserResponse>builder()
                .content(content)
                .page(result.getNumber() + 1)
                .size(result.getSize())
                .totalElements(result.getTotalElements())
                .totalPages(result.getTotalPages())
                .first(result.isFirst())
                .last(result.isLast())
                .build();
    }

    @Transactional(readOnly = true)
    public UserDetailResponse findById(UUID id) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));

        List<RoleEntity> roleEntities = (user.getRoleIds() == null || user.getRoleIds().isEmpty())
                ? List.of()
                : roleRepository.findByIdIn(new ArrayList<>(user.getRoleIds()));

        List<UUID> allPermIds = roleEntities.stream()
                .filter(r -> r.getPermissionIds() != null && !r.getPermissionIds().isEmpty())
                .flatMap(r -> r.getPermissionIds().stream())
                .distinct()
                .collect(Collectors.toList());
        Map<UUID, PermissionEntity> permMap = allPermIds.isEmpty()
                ? Map.of()
                : permissionRepository.findByIdIn(allPermIds).stream()
                        .collect(Collectors.toMap(PermissionEntity::getId, p -> p));

        List<com.example.backend.dto.role.RoleResponse> roles = roleEntities.stream()
                .map(r -> new com.example.backend.dto.role.RoleResponse(
                        r.getId().toString(),
                        r.getName(),
                        r.getDescription(),
                        (r.getPermissionIds() == null || r.getPermissionIds().isEmpty()) ? null
                                : r.getPermissionIds().stream()
                                        .map(permMap::get)
                                        .filter(Objects::nonNull)
                                        .map(p -> new com.example.backend.dto.permission.PermissionResponse(
                                                p.getId().toString(), p.getSlug(), p.getDescription()))
                                        .collect(Collectors.toList())))
                .collect(Collectors.toList());

        List<com.example.backend.dto.permission.PermissionResponse> permissions = permMap.values().stream()
                .map(p -> new com.example.backend.dto.permission.PermissionResponse(
                        p.getId().toString(), p.getSlug(), p.getDescription()))
                .collect(Collectors.toList());

        return new UserDetailResponse(
                user.getId().toString(),
                user.getEmail(),
                user.getUsername(),
                user.getFullName(),
                user.getJobTitle(),
                user.getDepartment(),
                user.getPhone(),
                user.getAvatarUrl(),
                user.getIsActive(),
                user.getMfaEnabled(),
                user.getVerified(),
                user.getStatus(),
                user.getCreatedAt(),
                roles,
                permissions
        );
    }

    @Transactional
    public UserDetailResponse updateProfile(UUID id, UserProfileUpdateRequest request, HttpServletRequest httpRequest) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));

        // jobTitle and department are admin-only — not updatable by user
        if (request.fullName()  != null) user.setFullName(request.fullName());
        if (request.phone()     != null) user.setPhone(request.phone());

        userRepository.save(user);
        return findById(id);
    }

    @Transactional
    public void changePassword(UUID id, PasswordChangeRequest request) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));

        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw new IllegalArgumentException("Current password is incorrect");
        }

        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        userRepository.save(user);
    }

    /**
     * Admin invites a new user.
     * Creates the user with a temporary random password,
     * sends a password-reset email so the user sets their own password.
     */
    @Transactional
    public UserDetailResponse inviteUser(InviteUserRequest request) {
        if (userRepository.existsByEmailAndDeletedAtIsNull(request.email())) {
            throw new ConflictException("Email already registered: " + request.email());
        }

        // Generate a secure temporary password the user will never see
        String tempPassword = UUID.randomUUID().toString();

        String username = deriveUsername(request.email());

        UserEntity user = UserEntity.builder()
                .email(request.email())
                .username(username)
                .passwordHash(passwordEncoder.encode(tempPassword))
                .fullName(request.fullName())
                .jobTitle(request.jobTitle())
                .department(request.department())
                .isActive(false)
                .verified(false)
                .status("PENDING")
                .build();

        // DB roles are named "Admin" and "User" — no slug column exists
        String roleName = (request.role() != null && !request.role().isBlank())
                ? request.role() : "User";
        roleRepository.findByName(roleName).ifPresent(r -> user.getRoleIds().add(r.getId()));

        userRepository.save(user);

        // Generate a one-use reset token (15 min expiry) for first-time password setup
        String resetToken = jwtService.generateResetToken(user.getEmail(), user.getId());
        String setPasswordUrl = frontendUrl + "/auth/set-password?token=" + resetToken;

        // Send invitation email with direct set-password link
        try {
            emailService.sendInvitationEmail(
                user.getEmail(),
                user.getFullName(),
                setPasswordUrl
            );
            log.info("Invitation email sent to {}", user.getEmail());
        } catch (Exception e) {
            log.error("Failed to send invitation email to {}: {}", user.getEmail(), e.getMessage(), e);
        }

        return findById(user.getId());
    }

    /**
     * Soft-delete + anonymize a user.
     *
     * Keeps fullName for audit reference ("Jane Doe invited X", "Jane Doe ran simulation").
     * Erases all PII: email, phone, avatar, password.
     * Sets status=REJECTED and isActive=false so they can never login.
     * The row is never hard-deleted — it becomes a tombstone for referential integrity.
     *
     * GDPR note: fullName is intentionally kept for operational audit trails.
     * If full erasure is required, call anonymizeFull() instead.
     */
    @Transactional
    public void deleteUser(UUID id) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));

        String shortId = id.toString().substring(0, 8);

        // Erase PII — keep fullName for audit reference
        user.setEmail("deleted-" + shortId + "@purged.local");
        user.setUsername("deleted-" + shortId);
        user.setPasswordHash(passwordEncoder.encode(java.util.UUID.randomUUID().toString()));
        user.setPhone(null);
        user.setAvatarUrl(null);
        user.setMfaSecret(null);
        user.setMfaEnabled(false);
        user.setIsActive(false);
        user.setVerified(false);
        user.setStatus("DELETED");
        user.setDeletedAt(Instant.now());
        // fullName intentionally preserved for audit trail reference

        userRepository.save(user);
        log.info("User anonymized: id={} name={}", shortId, user.getFullName());
    }

    /**
     * Toggle user active status with an optional reason logged.
     */
    @Transactional
    public void toggleStatus(UUID id, String reason, HttpServletRequest httpRequest) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));
        boolean wasActive = user.getIsActive();
        user.setIsActive(!wasActive);
        userRepository.save(user);
        // Send deactivation email only when deactivating (not when reactivating)
        if (wasActive) {
            try {
                emailService.sendDeactivationEmail(
                    user.getEmail(), user.getFullName(), reason);
                log.info("Deactivation email sent to {}", user.getEmail());
            } catch (Exception e) {
                log.error("Failed to send deactivation email to {}: {}",
                    user.getEmail(), e.getMessage());
            }
        }
    }

    @Transactional
    public void approveUser(UUID id) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));
        user.setIsActive(true);
        user.setVerified(true);
        user.setStatus("ACTIVE");
        userRepository.save(user);
        try {
            emailService.sendApprovalEmail(user.getEmail(), user.getFullName());
        } catch (Exception e) {
            log.error("Failed to send approval email to {}: {}", user.getEmail(), e.getMessage());
        }
    }

    @Transactional
    public void rejectUser(UUID id, String reason) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));
        user.setStatus("REJECTED");
        user.setDeletedAt(Instant.now());
        userRepository.save(user);
        try {
            emailService.sendRejectionEmail(user.getEmail(), user.getFullName(), reason);
        } catch (Exception e) {
            log.error("Failed to send rejection email to {}: {}", user.getEmail(), e.getMessage());
        }
    }

    /**
     * Returns all users with PENDING status awaiting admin approval.
     */
    @Transactional(readOnly = true)
    public List<UserResponse> getPendingUsers() {
        return userRepository.findAll().stream()
                .filter(u -> u.getDeletedAt() == null)
                .filter(u -> "PENDING".equals(u.getStatus()))
                .map(userMapper::toResponse)
                .toList();
    }

    /**
     * Assigns a role to a user by role name.
     * Replaces all existing roles with the new one.
     */
    @Transactional
    public UserDetailResponse assignRole(UUID userId, String roleName) {
        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));
        RoleEntity role = roleRepository.findByName(roleName)
                .orElseThrow(() -> new ResourceNotFoundException("Role", roleName));
        user.getRoleIds().clear();
        user.getRoleIds().add(role.getId());
        userRepository.save(user);
        return findById(userId);
    }

    /**
     * Get all permissions for a user:
     * role permissions + extra per-user permissions.
     */
    @Transactional(readOnly = true)
    public UserPermissionsResponse getUserPermissions(UUID userId) {
        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        List<RoleEntity> roleEntitiesForPerms = (user.getRoleIds() == null || user.getRoleIds().isEmpty())
                ? List.of()
                : roleRepository.findByIdIn(new ArrayList<>(user.getRoleIds()));
        List<UUID> rolePermIds = roleEntitiesForPerms.stream()
                .filter(r -> r.getPermissionIds() != null && !r.getPermissionIds().isEmpty())
                .flatMap(r -> r.getPermissionIds().stream())
                .distinct()
                .collect(Collectors.toList());
        var rolePerms = rolePermIds.isEmpty()
                ? List.<PermissionResponse>of()
                : permissionRepository.findByIdIn(rolePermIds).stream()
                        .map(p -> new PermissionResponse(p.getId().toString(), p.getSlug(), p.getDescription()))
                        .toList();

        var extraPerms = (user.getExtraPermissionIds() == null || user.getExtraPermissionIds().isEmpty())
                ? List.<PermissionResponse>of()
                : permissionRepository.findByIdIn(new ArrayList<>(user.getExtraPermissionIds())).stream()
                        .map(p -> new PermissionResponse(p.getId().toString(), p.getSlug(), p.getDescription()))
                        .toList();

        var allPerms = permissionRepository.findAll().stream()
                .map(p -> new PermissionResponse(p.getId().toString(), p.getSlug(), p.getDescription()))
                .toList();

        return new UserPermissionsResponse(userId, rolePerms, extraPerms, allPerms);
    }

    /**
     * Update per-user extra permissions.
     * permissionIds is the full list of extra permission IDs to assign.
     */
    @Transactional
    public void updateUserPermissions(UUID userId, java.util.List<String> permissionIds) {
        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        var validPermIds = permissionRepository.findAllById(
                permissionIds.stream().map(UUID::fromString).toList()
        ).stream()
                .map(PermissionEntity::getId)
                .collect(Collectors.toCollection(HashSet::new));
        user.getExtraPermissionIds().clear();
        user.getExtraPermissionIds().addAll(validPermIds);
        userRepository.save(user);
    }

    private String deriveUsername(String email) {
        String base = email.substring(0, email.indexOf('@')).toLowerCase().replaceAll("[^a-z0-9]", "");
        if (base.isEmpty()) base = "user";
        String candidate = base;
        int i = 0;
        while (userRepository.existsByUsernameAndDeletedAtIsNull(candidate)) {
            candidate = base + (++i);
        }
        return candidate;
    }

    private Boolean parseStatus(String status) {
        if (status == null || "all".equals(status)) return null;
        return "active".equals(status);
    }

    private String mapSortField(String sortBy) {
        if (sortBy == null || sortBy.isEmpty()) return "createdAt";
        return switch (sortBy) {
            case "created_at" -> "createdAt";
            case "full_name" -> "fullName";
            case "is_active" -> "isActive";
            default -> sortBy;
        };
    }
}
