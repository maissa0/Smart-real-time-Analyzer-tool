package com.example.backend.dto.v1;

import java.time.Instant;

public record SessionResponse(
        String id,
        String device,
        String ipAddress,
        String userAgent,
        Instant lastActive,
        Instant createdAt
) {
}
