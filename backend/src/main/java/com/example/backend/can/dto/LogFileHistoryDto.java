package com.example.backend.can.dto;

public record LogFileHistoryDto(
        Long id,
        String sessionId,
        String filename,
        String status,
        int frameCount,
        long fileSize,
        String createdAt
) {}
