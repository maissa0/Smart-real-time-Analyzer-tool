package com.example.backend.can.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.ToString;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * JPA entity for the cars table.
 * Represents a physical or virtual vehicle monitored by the CAN analyser.
 * car_uid is auto-generated as a UUID string if not provided.
 *
 * Note: @OneToMany to CanSessionEntity is intentionally omitted to avoid
 * lazy loading issues during JSON serialization. Use CanSessionRepository
 * to query sessions by car_id instead.
 */
@Entity
@Table(name = "cars")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CarEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Public UUID identifier — auto-generated on first persist if null.
     * Used as the external-facing identifier in REST APIs.
     */
    @Column(name = "car_uid", nullable = false, unique = true, length = 36)
    private String carUid;

    /**
     * Vehicle Identification Number — 17 chars ISO 3779.
     * NULL allowed for virtual/simulator cars.
     */
    @Column(name = "vin", unique = true, length = 17)
    private String vin;

    @Column(name = "make", nullable = false, length = 100)
    private String make;

    @Column(name = "model", nullable = false, length = 100)
    private String model;

    /**
     * Model year (e.g. 2024). Stored as SMALLINT in DB.
     */
    @Column(name = "year", nullable = false)
    private Integer year;

    @Column(name = "color", length = 50)
    private String color;

    /**
     * FK to ecu_catalogs.id — default ECU catalog for this car.
     * No @ManyToOne to avoid loading the full catalog on every car fetch.
     */
    @Column(name = "ecu_catalog_id")
    private Long ecuCatalogId;

    /**
     * ECU catalogs assigned to this car. The simulator restricts generated traffic
     * to these catalog files; an empty set means "use all catalogs" (legacy behaviour).
     * LAZY + excluded from toString/equals to avoid lazy-loading on every car fetch.
     */
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(
            name = "car_catalogs",
            joinColumns = @JoinColumn(name = "car_id"),
            inverseJoinColumns = @JoinColumn(name = "catalog_id"))
    @Builder.Default
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private Set<EcuCatalogEntity> catalogs = new HashSet<>();

    /**
     * Requirement sets assigned to this car. The requirements engine evaluates a
     * session ONLY against these files; an empty set disables requirement checks
     * for the car (unlike catalogs there is no merged-global fallback — merging
     * unrelated requirement sets would produce false violations).
     */
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(
            name = "car_requirement_sets",
            joinColumns = @JoinColumn(name = "car_id"),
            inverseJoinColumns = @JoinColumn(name = "requirement_set_id"))
    @Builder.Default
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private Set<RequirementSetEntity> requirementSets = new HashSet<>();

    /**
     * FK to users.id stored as BINARY(16).
     * Matches the users.id column type (UUID stored as binary).
     */
    @Column(name = "owner_user_id", columnDefinition = "BINARY(16)")
    private byte[] ownerUserId;

    /**
     * TRUE for simulator-only cars with no physical VIN.
     */
    @Column(name = "is_virtual", nullable = false)
    @Builder.Default
    private Boolean isVirtual = false;

    /**
     * Master switch — inactive cars cannot receive new sessions.
     */
    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = true;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    /**
     * Soft delete timestamp — null means the car is active.
     * Queries should filter WHERE deleted_at IS NULL.
     */
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    /**
     * Auto-generate carUid as a UUID string if not set before first persist.
     * This ensures every car has a unique public identifier without requiring
     * the caller to generate one.
     */
    @PrePersist
    protected void prePersist() {
        if (carUid == null || carUid.isBlank()) {
            carUid = UUID.randomUUID().toString();
        }
    }
}
