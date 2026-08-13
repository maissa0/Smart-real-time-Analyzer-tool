package com.example.backend.can.repository;

import com.example.backend.can.entity.DiagnosticRuleEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DiagnosticRuleRepository extends JpaRepository<DiagnosticRuleEntity, Long> {

    /** All enabled rules at a given scope/key — the caller picks by faultType. */
    List<DiagnosticRuleEntity> findByScopeAndMatchKeyAndEnabledTrue(String scope, String matchKey);

    /** All rules at a scope/key regardless of enabled — for idempotent seeding. */
    List<DiagnosticRuleEntity> findByScopeAndMatchKey(String scope, String matchKey);

    List<DiagnosticRuleEntity> findBySubsystemOrderByMatchKeyAsc(String subsystem);
}
