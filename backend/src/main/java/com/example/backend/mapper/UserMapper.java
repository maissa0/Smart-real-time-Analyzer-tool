package com.example.backend.mapper;

import com.example.backend.dto.role.RoleResponse;
import com.example.backend.dto.user.UserResponse;
import com.example.backend.entity.UserEntity;
import org.springframework.stereotype.Component;

import java.util.stream.Collectors;

@Component
public class UserMapper {

    public UserResponse toResponse(UserEntity entity) {
        if (entity == null) return null;

        var roles = entity.getRoles() == null ? null : entity.getRoles().stream()
                .map(r -> RoleResponse.builder()
                        .id(r.getId().toString())
                        .name(r.getName())
                        .description(r.getDescription())
                        .permissions(r.getPermissions() == null ? null : r.getPermissions().stream()
                                .map(p -> com.example.backend.dto.permission.PermissionResponse.builder()
                                        .id(p.getId().toString())
                                        .slug(p.getSlug())
                                        .description(p.getDescription())
                                        .build())
                                .collect(Collectors.toList()))
                        .build())
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
