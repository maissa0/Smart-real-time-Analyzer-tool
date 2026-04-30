package com.molka.smart_analyzer_backend.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "audit_logs", indexes = {
        @Index(name = "idx_audit_user_id",  columnList = "userId"),
        @Index(name = "idx_audit_timestamp", columnList = "timestamp")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuditLogEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Null for unauthenticated events (e.g. failed login). */
    @Column
    private Long userId;

    @Column(length = 150)
    private String username;

    /** e.g. LOGIN, LOGOUT, FILE_ANALYZED, USER_CREATED … */
    @Column(nullable = false, length = 100)
    private String action;

    /** e.g. AUTH, FILE, USER, SESSION, MFA */
    @Column(length = 100)
    private String resourceType;

    /** Optional reference to the affected entity id. */
    @Column(length = 36)
    private String resourceId;

    @Column(length = 64)
    private String ipAddress;

    @Column(length = 512)
    private String userAgent;

    @Column(nullable = false, updatable = false)
    private Instant timestamp;

    /** Freeform JSON string with extra context. */
    @Column(columnDefinition = "TEXT")
    private String details;

    @PrePersist
    protected void onCreate() {
        if (timestamp == null) timestamp = Instant.now();
    }
}
