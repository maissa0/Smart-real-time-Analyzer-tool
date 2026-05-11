package com.example.backend.service;

import com.example.backend.dto.common.PageResponse;
import com.example.backend.dto.user.UserResponse;
import com.example.backend.dto.v1.*;
import com.example.backend.entity.UserEntity;
import com.example.backend.exception.ResourceNotFoundException;
import com.example.backend.mapper.UserMapper;
import com.example.backend.repository.RoleRepository;
import com.example.backend.repository.UserRepository;
import com.example.backend.specification.UserSpecification;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class UserServiceV1 {

    private final UserRepository userRepository;
    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final RoleRepository roleRepository;
    private final EmailService emailService;

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

        var roles = user.getRoles() == null ? null : user.getRoles().stream()
                .map(r -> new com.example.backend.dto.role.RoleResponse(
                        r.getId().toString(),
                        r.getName(),
                        r.getDescription(),
                        r.getPermissions() == null ? null : r.getPermissions().stream()
                                .map(p -> new com.example.backend.dto.permission.PermissionResponse(
                                        p.getId().toString(),
                                        p.getSlug(),
                                        p.getDescription()))
                                .collect(Collectors.toList())))
                .collect(Collectors.toList());

        var permissions = user.getRoles() == null ? List.<com.example.backend.dto.permission.PermissionResponse>of()
                : user.getRoles().stream()
                .flatMap(r -> r.getPermissions() == null ? java.util.stream.Stream.<com.example.backend.dto.permission.PermissionResponse>empty()
                        : r.getPermissions().stream()
                        .map(p -> new com.example.backend.dto.permission.PermissionResponse(
                                p.getId().toString(),
                                p.getSlug(),
                                p.getDescription())))
                .distinct()
                .collect(Collectors.toList());

        return new UserDetailResponse(
                user.getId().toString(),
                user.getEmail(),
                user.getUsername(),
                user.getFullName(),
                user.getJobTitle(),
                user.getDepartment(),
                user.getTimezone(),
                user.getPhone(),
                user.getBio(),
                user.getAvatarUrl(),
                user.getIsActive(),
                user.getMfaEnabled(),
                user.getVerified(),
                user.getCreatedAt(),
                roles,
                permissions
        );
    }

    @Transactional
    public UserDetailResponse updateProfile(UUID id, UserProfileUpdateRequest request, HttpServletRequest httpRequest) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));

        if (request.fullName() != null) user.setFullName(request.fullName());
        if (request.jobTitle() != null) user.setJobTitle(request.jobTitle());
        if (request.department() != null) user.setDepartment(request.department());
        if (request.timezone() != null) user.setTimezone(request.timezone());
        if (request.phone() != null) user.setPhone(request.phone());
        if (request.bio() != null) user.setBio(request.bio());

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
            throw new IllegalArgumentException("Email already registered: " + request.email());
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
                .isActive(true)
                .verified(false)
                .build();

        // DB roles are named "Admin" and "User" — no slug column exists
        String roleName = (request.role() != null && !request.role().isBlank())
                ? request.role() : "User";
        roleRepository.findByName(roleName).ifPresent(r -> user.getRoles().add(r));

        userRepository.save(user);

        // Send invitation email with password reset link
        try {
            emailService.sendPasswordResetEmail(user.getEmail(), user.getFullName(),
                    "You have been invited to KPIT Smart CAN Analyser. " +
                    "Use the link below to set your password.");
        } catch (Exception e) {
            // Log but don't fail — user is created, email can be resent
        }

        return findById(user.getId());
    }

    /**
     * Soft-delete a user by setting deletedAt timestamp.
     */
    @Transactional
    public void deleteUser(UUID id) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));
        user.setDeletedAt(Instant.now());
        userRepository.save(user);
    }

    /**
     * Toggle user active status with an optional reason logged.
     */
    @Transactional
    public void toggleStatus(UUID id, String reason, HttpServletRequest httpRequest) {
        UserEntity user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));
        user.setIsActive(!user.getIsActive());
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

    /**
     * Maps UI role slugs to seeded {@link RoleEntity#getName()} values (Admin / User).
     */
    private static String mapInviteRoleSelectToDbRoleName(String slug) {
        if (slug == null || slug.isBlank()) {
            return "User";
        }
        return switch (slug) {
            case "ROLE_ADMIN" -> "Admin";
            case "ROLE_ANALYST", "ROLE_VIEWER" -> "User";
            default -> "User";
        };
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
