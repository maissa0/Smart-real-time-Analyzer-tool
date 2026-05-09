package com.example.backend.can.repository;

import com.example.backend.can.entity.CarEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for CarEntity — vehicle fleet data access.
 *
 * Query strategy:
 * - findByCarUid: external API lookups use car_uid (public UUID), not internal id
 * - findByOwnerUserId: list cars belonging to a specific user (binary(16) key)
 * - findAllActive / findByIsActiveTrue: dashboard and selector queries
 *   always filter deleted_at IS NULL (soft delete) and is_active = true
 */
@Repository
public interface CarRepository extends JpaRepository<CarEntity, Long> {

    /**
     * Find a car by its public UUID identifier.
     * Used in REST API path variables: GET /api/cars/{carUid}
     */
    Optional<CarEntity> findByCarUid(String carUid);

    /**
     * Find all active non-deleted cars owned by a specific user.
     * ownerUserId is stored as BINARY(16) matching users.id column type.
     */
    List<CarEntity> findByOwnerUserIdAndIsActiveTrueAndDeletedAtIsNull(byte[] ownerUserId);

    /**
     * Find all active non-deleted cars regardless of owner.
     * Used for admin views and global car selectors.
     */
    List<CarEntity> findByIsActiveTrueAndDeletedAtIsNull();

    /**
     * Find all active non-deleted cars ordered by creation date descending.
     * Equivalent to findByIsActiveTrueAndDeletedAtIsNull but with explicit ordering.
     */
    @Query("SELECT c FROM CarEntity c WHERE c.isActive = true AND c.deletedAt IS NULL ORDER BY c.createdAt DESC")
    List<CarEntity> findAllActive();

    /**
     * Count active non-deleted cars — used for dashboard statistics.
     */
    long countByIsActiveTrueAndDeletedAtIsNull();
}
