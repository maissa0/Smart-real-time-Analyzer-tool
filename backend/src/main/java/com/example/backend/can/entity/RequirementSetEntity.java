package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * Registry row for one user-uploaded requirement-set YAML file (mirror of
 * {@link EcuCatalogEntity} for catalogs). The file on disk is the source of
 * truth; this row carries metadata for listing and car assignment.
 */
@Entity
@Table(name = "requirement_sets")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RequirementSetEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "filename", nullable = false, unique = true, length = 255)
    private String filename;

    @Column(name = "version", length = 20)
    private String version;

    @Column(name = "description", length = 500)
    private String description;

    @Column(name = "rule_count", nullable = false)
    @Builder.Default
    private Integer ruleCount = 0;

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = true;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
