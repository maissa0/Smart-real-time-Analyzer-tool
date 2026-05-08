package com.example.backend.repository;

import com.example.backend.entity.OtpCodeEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface OtpCodeRepository extends JpaRepository<OtpCodeEntity, UUID> {

    Optional<OtpCodeEntity> findByEmailAndCodeAndUsedAtIsNullAndExpiresAtAfter(
            String email, String code, Instant now);

    void deleteByExpiresAtBefore(Instant instant);
}
