package com.example.backend.can.dto;

public record PlaybackStartEvent(
        String type,
        String playbackId,
        String sessionId,
        double speed,
        double sessionStartTs
) {}
