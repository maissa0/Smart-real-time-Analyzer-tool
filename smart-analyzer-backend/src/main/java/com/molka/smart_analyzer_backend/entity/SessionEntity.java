package com.molka.smart_analyzer_backend.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "user_sessions", indexes = {
        @Index(name = "idx_session_user_id", columnList = "userId"),
        @Index(name = "idx_session_token_hash", columnList = "tokenHash", unique = true)
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SessionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    @Column(nullable = false, length = 64)
    private String tokenHash;

    @Column(length = 64)
    private String ipAddress;

    @Column(length = 512)
    private String userAgent;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant lastActiveAt;

    @Column(nullable = false)
    private Instant expiresAt;

    @Column(nullable = false)
    private boolean revoked;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) createdAt = Instant.now();
        if (lastActiveAt == null) lastActiveAt = createdAt;
    }
}
