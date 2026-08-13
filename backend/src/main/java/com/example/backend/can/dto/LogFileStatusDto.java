package com.example.backend.can.dto;

public record LogFileStatusDto(
        String sessionId,
        String filename,
        String status,
        int frameCount,
        long fileSize,
        int channelCount,
        double durationSeconds,
        String createdAt
) {}
