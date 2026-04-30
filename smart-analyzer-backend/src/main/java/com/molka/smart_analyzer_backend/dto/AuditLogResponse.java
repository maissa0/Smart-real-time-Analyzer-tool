package com.molka.smart_analyzer_backend.dto;

import java.time.Instant;

public record AuditLogResponse(
        Long    id,
        Long    userId,
        String  username,
        String  action,
        String  resourceType,
        String  resourceId,
        String  ipAddress,
        String  userAgent,
        Instant timestamp,
        String  details
) {}
