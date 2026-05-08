package com.example.backend.config;

import com.example.backend.entity.PermissionEntity;
import com.example.backend.entity.RoleEntity;
import com.example.backend.entity.UserEntity;
import com.example.backend.repository.PermissionRepository;
import com.example.backend.repository.RoleRepository;
import com.example.backend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Seeds permissions, roles, role-permission mappings, and default admin/user accounts on startup.
 * Idempotent: skips inserts when data already exists.
 */
@Component
@Profile("!test")
@RequiredArgsConstructor
@Slf4j
public class DataInitializer implements CommandLineRunner {

    private static final List<String> PERMISSION_SLUGS = List.of(
            "user:read", "user:write", "user:create", "audit:view", "billing:view"
    );

    private static final String ADMIN_EMAIL = "admin@ablepro.com";
    private static final String ADMIN_USERNAME = "admin";
    private static final String ADMIN_PASSWORD = "Admin123!";
    private static final String USER_EMAIL = "user@ablepro.com";
    private static final String USER_USERNAME = "user";
    private static final String USER_PASSWORD = "User123!";

    private final PermissionRepository permissionRepository;
    private final RoleRepository roleRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    @Transactional
    public void run(String... args) {
        // Step 1: Seed Permissions (idempotent via findBySlug)
        var permissions = seedPermissions();

        // Step 2: Seed Roles (idempotent via findByName)
        // Names "Admin"/"User" become ROLE_ADMIN/ROLE_USER via CustomUserDetailsService
        var adminRole = seedRole("Admin", "Administrator with full access", permissions);
        var userRole = seedRole("User", "Standard user", List.of());

        // Step 3: Seed Admin & User Accounts (idempotent via existsByEmail)
        seedAdminUser(adminRole);
        seedStandardUser(userRole);

        log.info("[DataInitializer] Default Admin and User accounts have been initialized.");
    }

    /**
     * Step 1: Seed permissions. Uses findBySlug to avoid duplicates.
     */
    private List<PermissionEntity> seedPermissions() {
        var descriptions = List.of(
                "View users", "Create and edit users", "Create users", "View audit logs", "View billing"
        );
        var result = new java.util.ArrayList<PermissionEntity>();
        for (int i = 0; i < PERMISSION_SLUGS.size(); i++) {
            var slug = PERMISSION_SLUGS.get(i);
            var desc = descriptions.get(i);
            var perm = permissionRepository.findBySlug(slug)
                    .orElseGet(() -> {
                        var p = PermissionEntity.builder()
                                .slug(slug)
                                .description(desc)
                                .createdAt(Instant.now())
                                .updatedAt(Instant.now())
                                .build();
                        p.setId(UUID.randomUUID());
                        return permissionRepository.save(p);
                    });
            result.add(perm);
        }
        return result;
    }

    /**
     * Step 2: Seed a role. Uses findByName to avoid duplicates.
     */
    private RoleEntity seedRole(String name, String description, List<PermissionEntity> permissions) {
        return roleRepository.findByName(name)
                .orElseGet(() -> {
                    var r = RoleEntity.builder()
                            .name(name)
                            .description(description)
                            .createdAt(Instant.now())
                            .updatedAt(Instant.now())
                            .permissions(new HashSet<>(permissions))
                            .build();
                    r.setId(UUID.randomUUID());
                    return roleRepository.save(r);
                });
    }

    /**
     * Step 3: Seed admin user. Uses existsByEmailAndDeletedAtIsNull for idempotency.
     */
    private void seedAdminUser(RoleEntity adminRole) {
        if (userRepository.existsByEmailAndDeletedAtIsNull(ADMIN_EMAIL)) {
            return;
        }
        var admin = UserEntity.builder()
                .email(ADMIN_EMAIL)
                .username(ADMIN_USERNAME)
                .passwordHash(passwordEncoder.encode(ADMIN_PASSWORD))
                .fullName("Administrator")
                .jobTitle("System Administrator")
                .department("IT")
                .timezone("UTC")
                .isActive(true)
                .mfaEnabled(false)
                .verified(true)
                .roles(Set.of(adminRole))
                .build();
        userRepository.save(admin);
    }

    /**
     * Step 3: Seed standard user.
     */
    private void seedStandardUser(RoleEntity userRole) {
        if (userRepository.existsByEmailAndDeletedAtIsNull(USER_EMAIL)) {
            return;
        }
        var user = UserEntity.builder()
                .email(USER_EMAIL)
                .username(USER_USERNAME)
                .passwordHash(passwordEncoder.encode(USER_PASSWORD))
                .fullName("Standard User")
                .jobTitle("User")
                .department("General")
                .timezone("UTC")
                .isActive(true)
                .mfaEnabled(false)
                .verified(true)
                .roles(Set.of(userRole))
                .build();
        userRepository.save(user);
    }
}
