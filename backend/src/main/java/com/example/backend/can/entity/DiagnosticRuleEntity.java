package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;

/**
 * One user-refinable diagnostic rule. Faults are translated by a layered lookup:
 * SIGNAL (matchKey = signal name) -> MESSAGE (matchKey = msg name) ->
 * SUBSYSTEM (matchKey = subsystem label) -> DEFAULT (matchKey = "*"), each
 * optionally scoped to a faultType (null faultType matches any type).
 */
@Entity
@Table(name = "diagnostic_rule")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiagnosticRuleEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** SIGNAL | MESSAGE | SUBSYSTEM | DEFAULT */
    @Column(name = "scope", nullable = false, length = 20)
    private String scope;

    /** Signal name / message name / subsystem label / "*" for DEFAULT. */
    @Column(name = "match_key", nullable = false)
    private String matchKey;

    /** DUPLICATE | TIMING_GAP | SIGNAL_RANGE | COUNTER_ERROR, or null = any. */
    @Column(name = "fault_type", length = 30)
    private String faultType;

    /** Owning subsystem label (for grouping + verdict). */
    @Column(name = "subsystem")
    private String subsystem;

    /** Short plain-English fault title, e.g. "Power Steering Assist Failure". */
    @Column(name = "title", length = 200)
    private String title;

    @Column(name = "meaning", length = 1000)
    private String meaning;

    @Column(name = "likely_cause", length = 1000)
    private String likelyCause;

    @Column(name = "what_to_check", length = 1000)
    private String whatToCheck;

    /** Higher = more severe; drives the deterministic subsystem verdict. */
    @Column(name = "severity_weight", nullable = false)
    private int severityWeight;

    /** Optional friendly display name for the signal/message. */
    @Column(name = "display_name")
    private String displayName;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    /** True for seeded rules; user-created rules are false. */
    @Column(name = "builtin", nullable = false)
    private boolean builtin;

    @Column(name = "updated_by")
    private String updatedBy;

    @CreatedDate
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
