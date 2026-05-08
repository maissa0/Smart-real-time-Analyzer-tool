package com.example.backend.repository;

import com.example.backend.entity.MfaRecoveryCodeEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MfaRecoveryCodeRepository extends JpaRepository<MfaRecoveryCodeEntity, UUID> {

    List<MfaRecoveryCodeEntity> findByUserId(UUID userId);

    Optional<MfaRecoveryCodeEntity> findByUserIdAndCodeHashAndUsedAtIsNull(UUID userId, String codeHash);

    void deleteByUserId(UUID userId);
}
