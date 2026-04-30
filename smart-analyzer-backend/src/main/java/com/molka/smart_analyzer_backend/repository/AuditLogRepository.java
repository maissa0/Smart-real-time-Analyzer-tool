package com.molka.smart_analyzer_backend.repository;

import com.molka.smart_analyzer_backend.entity.AuditLogEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditLogRepository extends JpaRepository<AuditLogEntity, Long> {

    Page<AuditLogEntity> findByUserIdOrderByTimestampDesc(Long userId, Pageable pageable);

    Page<AuditLogEntity> findAllByOrderByTimestampDesc(Pageable pageable);
}
