package com.example.backend.can.repository;

import com.example.backend.can.entity.CanSessionEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface CanSessionRepository extends JpaRepository<CanSessionEntity, Long> {

    @Modifying
    @Transactional
    @Query("UPDATE CanSessionEntity s SET s.frameCount = COALESCE(s.frameCount, 0) + 1 WHERE s.sessionId = :sessionId")
    void incrementFrameCount(@Param("sessionId") String sessionId);

    Optional<CanSessionEntity> findBySessionId(String sessionId);

    List<CanSessionEntity> findAllByOrderByCreatedAtDesc();

    Page<CanSessionEntity> findAllByOrderByCreatedAtDesc(Pageable pageable);

    void deleteBySessionId(String sessionId);

    /** Find all sessions belonging to a car, ordered by creation date desc. */
    List<CanSessionEntity> findByCarIdOrderByCreatedAtDesc(Long carId);

    /** Count sessions belonging to a car. */
    long countByCarId(Long carId);

    /**
     * Aggregate session stats for a car: session count, total frames, last session date.
     * Returns List with a single row Object[] { COUNT, SUM, MAX } (JPQL aggregate shape).
     */
    @Query("SELECT COUNT(s), COALESCE(SUM(s.frameCount), 0), MAX(s.createdAt) " +
           "FROM CanSessionEntity s WHERE s.carId = :carId")
    List<Object[]> getCarSessionStats(@Param("carId") Long carId);

    /**
     * Dashboard aggregate: total session count, total frames, active session count.
     * Returns Object[] { totalSessions(Long), totalFrames(Long), activeSessions(Long) }
     */
    @Query("SELECT COUNT(s), COALESCE(SUM(s.frameCount), 0), " +
           "SUM(CASE WHEN s.status = 'live' THEN 1 ELSE 0 END) " +
           "FROM CanSessionEntity s")
    List<Object[]> getDashboardSessionStats();

    /**
     * Recent sessions for dashboard — last N sessions ordered by createdAt DESC.
     */
    @Query("SELECT s FROM CanSessionEntity s ORDER BY s.createdAt DESC")
    List<CanSessionEntity> findRecentSessions(Pageable pageable);
}
