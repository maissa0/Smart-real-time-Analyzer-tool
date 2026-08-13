package com.example.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.SQLRestriction;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * User entity with soft delete (deleted_at).
 * Extends AbstractAuditingEntity for created_at/updated_at.
 */
@Entity
@Table(name = "users")
@SQLRestriction("deleted_at IS NULL")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserEntity extends AbstractAuditingEntity {

    @Id
    @Column(name = "id", columnDefinition = "BINARY(16)")
    private UUID id;

    @Column(name = "email", nullable = false, unique = true, length = 255)
    private String email;

    @Column(name = "username", nullable = false, unique = true, length = 100)
    private String username;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "full_name", length = 255)
    private String fullName;

    @Column(name = "job_title", length = 100)
    private String jobTitle;

    @Column(name = "department", length = 100)
    private String department;

    @Column(name = "phone", length = 50)
    private String phone;

    @Column(name = "avatar_url", length = 500)
    private String avatarUrl;

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = true;

    @Column(name = "mfa_enabled", nullable = false)
    @Builder.Default
    private Boolean mfaEnabled = false;

    @Column(name = "mfa_secret", length = 255)
    private String mfaSecret;

    @Column(name = "verified", nullable = false)
    @Builder.Default
    private Boolean verified = false;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    /**
     * Account status:
     * PENDING  — registered, waiting for admin approval
     * ACTIVE   — approved, can login
     * REJECTED — registration denied by admin
     * SUSPENDED — temporarily blocked by admin (future use)
     */
    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private String status = "ACTIVE";

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(name = "user_roles", joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "role_id", columnDefinition = "BINARY(16)")
    @Builder.Default
    private Set<UUID> roleIds = new HashSet<>();

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(name = "user_permissions", joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "permission_id", columnDefinition = "BINARY(16)")
    @Builder.Default
    private Set<UUID> extraPermissionIds = new HashSet<>();

    @PrePersist
    protected void onCreate() {
        if (id == null) id = UUID.randomUUID();
    }
}
