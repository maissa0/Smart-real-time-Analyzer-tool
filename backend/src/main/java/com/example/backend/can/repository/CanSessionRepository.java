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
}
