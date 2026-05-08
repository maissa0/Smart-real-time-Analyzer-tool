package com.example.backend.repository;

import com.example.backend.entity.RefreshTokenEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepository extends JpaRepository<RefreshTokenEntity, UUID> {

    Optional<RefreshTokenEntity> findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(
            String tokenHash, Instant now);

    List<RefreshTokenEntity> findByUserIdAndRevokedAtIsNull(UUID userId);

    List<RefreshTokenEntity> findBySessionId(UUID sessionId);

    void deleteByUserId(UUID userId);

    void deleteByExpiresAtBefore(Instant instant);
}
