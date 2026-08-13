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
) {
    public CanFrameResponse(Long id, String sessionId, Double timestamp, Integer channel,
                            String channelName, String msgId, String msgName,
                            String direction, String rawBytes) {
        this(id, sessionId, timestamp, channel, channelName, msgId, msgName, direction, rawBytes, null);
    }
}
