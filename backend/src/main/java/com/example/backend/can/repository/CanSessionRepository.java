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
     * Returns Object[] { sessionCount (Long), totalFrames (Long), lastSessionAt (LocalDateTime) }
     */
    @Query("SELECT COUNT(s), COALESCE(SUM(s.frameCount), 0), MAX(s.createdAt) " +
           "FROM CanSessionEntity s WHERE s.carId = :carId")
    Object[] getCarSessionStats(@Param("carId") Long carId);
}
