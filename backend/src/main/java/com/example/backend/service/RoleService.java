package com.example.backend.service;

import com.example.backend.dto.v1.*;
import com.example.backend.entity.PermissionEntity;
import com.example.backend.entity.RoleEntity;
import com.example.backend.exception.ResourceNotFoundException;
import com.example.backend.repository.PermissionRepository;
import com.example.backend.repository.RoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class RoleService {

    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;

    @Transactional(readOnly = true)
    public List<RoleWithPermissionsResponse> findAllRolesWithPermissions() {
        return roleRepository.findAll().stream()
                .map(this::toRoleWithPermissions)
                .collect(Collectors.toList());
    }

    @Transactional
    public RoleWithPermissionsResponse updateRolePermissions(UUID roleId, RolePermissionsUpdateRequest request) {
        RoleEntity role = roleRepository.findById(roleId)
                .orElseThrow(() -> new ResourceNotFoundException("Role", roleId));

        List<PermissionEntity> permissions = permissionRepository.findAllById(
                request.permissionIds().stream().map(UUID::fromString).collect(Collectors.toList())
        );
        role.getPermissionIds().clear();
        permissions.forEach(p -> role.getPermissionIds().add(p.getId()));
        roleRepository.save(role);

        return toRoleWithPermissions(role);
    }

    @Transactional(readOnly = true)
    public List<PermissionSlugResponse> findAllPermissionSlugs() {
        return permissionRepository.findAll().stream()
                .map(p -> new PermissionSlugResponse(
                        p.getId().toString(),
                        p.getSlug(),
                        p.getDescription()))
                .collect(Collectors.toList());
    }

    private RoleWithPermissionsResponse toRoleWithPermissions(RoleEntity r) {
        List<com.example.backend.dto.permission.PermissionResponse> perms =
                (r.getPermissionIds() == null || r.getPermissionIds().isEmpty())
                        ? null
                        : permissionRepository.findByIdIn(new java.util.ArrayList<>(r.getPermissionIds())).stream()
                                .map(p -> new com.example.backend.dto.permission.PermissionResponse(
                                        p.getId().toString(),
                                        p.getSlug(),
                                        p.getDescription()))
                                .collect(Collectors.toList());
        return new RoleWithPermissionsResponse(
                r.getId().toString(),
                r.getName(),
                r.getDescription(),
                perms
        );
    }
}
