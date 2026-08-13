package com.example.backend.mapper;

import com.example.backend.dto.permission.PermissionResponse;
import com.example.backend.dto.role.RoleResponse;
import com.example.backend.dto.user.UserResponse;
import com.example.backend.entity.PermissionEntity;
import com.example.backend.entity.RoleEntity;
import com.example.backend.entity.UserEntity;
import com.example.backend.repository.PermissionRepository;
import com.example.backend.repository.RoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class UserMapper {

    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;

    public UserResponse toResponse(UserEntity entity) {
        if (entity == null) return null;

        List<RoleEntity> roleEntities = (entity.getRoleIds() == null || entity.getRoleIds().isEmpty())
                ? List.of()
                : roleRepository.findByIdIn(new ArrayList<>(entity.getRoleIds()));

        // Batch-load all permissions for all roles in a single query
        List<UUID> allPermIds = roleEntities.stream()
                .filter(r -> r.getPermissionIds() != null && !r.getPermissionIds().isEmpty())
                .flatMap(r -> r.getPermissionIds().stream())
                .distinct()
                .collect(Collectors.toList());
        Map<UUID, PermissionEntity> permissionMap = allPermIds.isEmpty()
                ? Map.of()
                : permissionRepository.findByIdIn(allPermIds).stream()
                        .collect(Collectors.toMap(PermissionEntity::getId, p -> p));

        var roles = roleEntities.stream()
                .map(r -> {
                    var perms = (r.getPermissionIds() == null || r.getPermissionIds().isEmpty())
                            ? null
                            : r.getPermissionIds().stream()
                                    .map(permissionMap::get)
                                    .filter(Objects::nonNull)
                                    .map(p -> PermissionResponse.builder()
                                            .id(p.getId().toString())
                                            .slug(p.getSlug())
                                            .description(p.getDescription())
                                            .build())
                                    .collect(Collectors.toList());
                    return RoleResponse.builder()
                            .id(r.getId().toString())
                            .name(r.getName())
                            .description(r.getDescription())
                            .permissions(perms)
                            .build();
                })
                .collect(Collectors.toList());

        return UserResponse.builder()
                .id(entity.getId().toString())
                .email(entity.getEmail())
                .username(entity.getUsername())
                .fullName(entity.getFullName())
                .jobTitle(entity.getJobTitle())
                .department(entity.getDepartment())
                .phone(entity.getPhone())
                .avatarUrl(entity.getAvatarUrl())
                .isActive(entity.getIsActive())
                .mfaEnabled(entity.getMfaEnabled())
                .verified(entity.getVerified())
                .status(entity.getStatus())
                .createdAt(entity.getCreatedAt())
                .roles(roles)
                .build();
    }
}
