package com.molka.smart_analyzer_backend.repository;

import com.molka.smart_analyzer_backend.entity.SessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface SessionRepository extends JpaRepository<SessionEntity, Long> {

    List<SessionEntity> findByUserIdAndRevokedFalseAndExpiresAtAfterOrderByCreatedAtDesc(
            Long userId, Instant now);

    Optional<SessionEntity> findByIdAndUserId(Long id, Long userId);

    Optional<SessionEntity> findByTokenHash(String tokenHash);

    @Modifying
    @Query("UPDATE SessionEntity s SET s.revoked = true WHERE s.userId = :userId AND s.tokenHash <> :currentHash AND s.revoked = false")
    int revokeAllExcept(@Param("userId") Long userId, @Param("currentHash") String currentHash);

    void deleteByExpiresAtBefore(Instant now);
}
