package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;

@Entity
@Table(name = "integrity_faults")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IntegrityFaultEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private String sessionId;

    @Column(name = "frame_id")
    private Long frameId;

    @Column(name = "msg_id")
    private String msgId;

    @Column(name = "msg_name")
    private String msgName;

    @Column(name = "fault_type", nullable = false)
    private String faultType;

    @Column(name = "description", length = 500)
    private String description;

    @Column(name = "frame_timestamp")
    private Double frameTimestamp;

    /**
     * JSON snapshot of the relevant signal state at the moment this fault was raised
     * (affected message's own signals + vehicle-state context: gear / speed / engine /
     * key / doors, plus ADAS extras for ADAS faults). Populated at detection for new
     * sessions; back-filled on demand from InfluxDB for older sessions.
     * Shape: [{"name":"Gear_Position","value":3.0,"label":"Drive"}, ...].
     */
    @Column(name = "context_json", columnDefinition = "TEXT")
    private String contextJson;

    /**
     * How many times this exact fault (same session, message, type, signal) has
     * fired. Repeated occurrences increment this counter instead of inserting a
     * new row, so a stuck signal on a fast cyclic message cannot flood the table.
     */
    @Builder.Default
    @Column(name = "occurrences", nullable = false)
    private Integer occurrences = 1;

    /** Frame timestamp (absolute Unix seconds) of the most recent occurrence. */
    @Column(name = "last_seen_ts")
    private Double lastSeenTs;

    /**
     * Detection layer this finding came from (V8): SPEC (deterministic catalog
     * checks), REQUIREMENT (per-car requirements engine), ML (anomaly engine).
     */
    @Builder.Default
    @Column(name = "layer", nullable = false)
    private String layer = "SPEC";

    /** Rule id from the requirement file — REQUIREMENT layer only. */
    @Column(name = "requirement_id")
    private String requirementId;

    /** Rule severity (CRITICAL|HIGH|MEDIUM|LOW|INFO) — REQUIREMENT layer only. */
    @Column(name = "severity")
    private String severity;

    /**
     * JSON evidence for the finding: trigger timestamp, deadline, observed
     * value/latency — whatever the evaluating rule kind measured.
     */
    @Column(name = "evidence_json", columnDefinition = "TEXT")
    private String evidenceJson;

    /** JSON array of diagnostic check-list entries copied from the rule. */
    @Column(name = "check_list_json", columnDefinition = "TEXT")
    private String checkListJson;

    /**
     * Root-cause cluster key (V9), session-scoped: findings sharing an
     * ECU/subsystem within a short time window carry the same value, so the UI
     * can present "Body & Comfort: 3 findings in 2s" as one probable cause.
     */
    @Column(name = "cluster_id", length = 120)
    private String clusterId;

    /**
     * JSON correlation links (V9). On a REQUIREMENT finding: the ML findings
     * attached as supporting evidence. On an ML finding: the requirement
     * finding it supports (which is also why its severity may exceed LOW).
     */
    @Column(name = "correlation_json", columnDefinition = "TEXT")
    private String correlationJson;

    @CreatedDate
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
