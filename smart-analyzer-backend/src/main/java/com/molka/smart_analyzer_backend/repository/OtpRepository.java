package com.molka.smart_analyzer_backend.repository;

import com.molka.smart_analyzer_backend.entity.OtpEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;

public interface OtpRepository extends JpaRepository<OtpEntity, Long> {

    Optional<OtpEntity> findTopByEmailAndCodeAndUsedFalseAndExpiresAtAfterOrderByCreatedAtDesc(
            String email, String code, Instant now);

    void deleteByExpiresAtBefore(Instant now);
}
