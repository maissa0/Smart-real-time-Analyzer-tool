package com.example.backend.can.dto;

import java.time.LocalDateTime;

public record CanSessionResponse(
        Long id,
        String sessionId,
        String sourceFilename,
        Double startTs,
        Double endTs,
        Integer frameCount,
        LocalDateTime createdAt
) {}
