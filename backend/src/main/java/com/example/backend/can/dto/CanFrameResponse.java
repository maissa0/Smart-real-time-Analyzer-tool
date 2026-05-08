package com.example.backend.can.dto;

public record CanFrameResponse(
        Long id,
        String sessionId,
        Double timestamp,
        Integer channel,
        String channelName,
        String msgId,
        String msgName,
        String direction,
        String rawBytes,
        String signals
) {}
