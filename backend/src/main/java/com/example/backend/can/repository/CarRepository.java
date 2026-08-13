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

    /**
     * Find a car by carUid with its assigned catalogs eagerly fetched.
     * Used by catalog-assignment reads and the simulator start path so the
     * LAZY collection is usable outside a transaction.
     */
    @Query("SELECT c FROM CarEntity c LEFT JOIN FETCH c.catalogs WHERE c.carUid = :carUid")
    Optional<CarEntity> findByCarUidWithCatalogs(String carUid);

    /**
     * Catalog filenames assigned to a car — used by the integrity analyzer to
     * resolve a session's catalog scope without loading the full entity graph.
     */
    @Query("SELECT cat.filename FROM CarEntity c JOIN c.catalogs cat WHERE c.id = :carId")
    List<String> findCatalogFilenamesByCarId(Long carId);

    /**
     * Find a car by carUid with its assigned requirement sets eagerly fetched.
     * Used by requirement-assignment reads (mirror of findByCarUidWithCatalogs).
     */
    @Query("SELECT c FROM CarEntity c LEFT JOIN FETCH c.requirementSets WHERE c.carUid = :carUid")
    Optional<CarEntity> findByCarUidWithRequirements(String carUid);

    /**
     * Requirement-set filenames assigned to a car — used by the requirements
     * engine to resolve a session's rule scope without the full entity graph.
     */
    @Query("SELECT r.filename FROM CarEntity c JOIN c.requirementSets r WHERE c.id = :carId")
    List<String> findRequirementFilenamesByCarId(Long carId);

    /**
     * Catalog filenames of every active car a requirement file is assigned to —
     * the signal scope for the structured requirement editor (Phase A of
     * docs/REQUIREMENTS_AUTHORING_PLAN.md).
     */
    @Query("""
            SELECT DISTINCT cat.filename FROM CarEntity c
            JOIN c.requirementSets r JOIN c.catalogs cat
            WHERE r.filename = :filename AND c.isActive = true AND c.deletedAt IS NULL""")
    List<String> findCatalogFilenamesByRequirementFilename(String filename);

    /** Catalog filenames of one car by public uid — car-scoped signal context. */
    @Query("SELECT cat.filename FROM CarEntity c JOIN c.catalogs cat WHERE c.carUid = :carUid")
    List<String> findCatalogFilenamesByCarUid(String carUid);

    /** Number of active cars a requirement file is assigned to (0 = unscoped). */
    @Query("""
            SELECT COUNT(c) FROM CarEntity c JOIN c.requirementSets r
            WHERE r.filename = :filename AND c.isActive = true AND c.deletedAt IS NULL""")
    long countCarsByRequirementFilename(String filename);
}
