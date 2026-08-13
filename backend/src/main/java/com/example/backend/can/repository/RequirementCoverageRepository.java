package com.example.backend.can.repository;

import com.example.backend.can.entity.RequirementCoverageEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/** PASS-counter snapshots persisted while sessions run (one row per rule). */
public interface RequirementCoverageRepository
        extends JpaRepository<RequirementCoverageEntity, Long> {

    List<RequirementCoverageEntity> findBySessionId(String sessionId);

    // @Transactional here so the derived delete also works from the
    // non-transactional @Scheduled sweep in RequirementMonitorService.
    @Transactional
    void deleteBySessionId(String sessionId);
}
