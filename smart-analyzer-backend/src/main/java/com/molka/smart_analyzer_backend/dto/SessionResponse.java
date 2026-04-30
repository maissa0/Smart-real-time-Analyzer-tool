package com.molka.smart_analyzer_backend.dto;

import java.time.Instant;

public record SessionResponse(
        Long id,
        String ipAddress,
        String userAgent,
        Instant createdAt,
        Instant lastActiveAt,
        Instant expiresAt,
        boolean isCurrent
) {}
