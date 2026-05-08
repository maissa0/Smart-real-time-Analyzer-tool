package com.example.backend.dto.v1;

import com.example.backend.entity.AuditLogEntity.AuditSource;

import java.time.Instant;
import java.util.Map;

public record AuditLogResponse(
        String id,
        String userId,
        String action,
        String resource,
        String resourceId,
        Map<String, Object> metadata,
        String ipAddress,
        String userAgent,
        AuditSource source,
        Instant createdAt
) {
}
