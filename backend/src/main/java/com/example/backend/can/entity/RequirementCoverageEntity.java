package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * Per-rule PASS counter snapshot, written when a session completes.
 *
 * Violations are reconstructed from IntegrityFaultEntity rows, but passes
 * raise no fault row — before this table they lived only in the in-memory
 * requirement engine, so a backend restart turned every passed rule into
 * NOT_TESTED in the session requirements report.
 */
@Entity
@Table(name = "requirement_rule_coverage",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_req_coverage",
                columnNames = {"session_id", "requirement_id"}),
        indexes = @Index(name = "idx_req_coverage_session", columnList = "session_id"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RequirementCoverageEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private String sessionId;

    @Column(name = "requirement_id", nullable = false)
    private String requirementId;

    @Column(name = "pass_count", nullable = false)
    private Long passCount;
}
