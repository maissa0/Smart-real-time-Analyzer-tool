package com.example.backend.can.dto;

public record PlaybackStartResponse(
        String playbackId,
        String sessionId,
        String status,
        String topic
) {}
