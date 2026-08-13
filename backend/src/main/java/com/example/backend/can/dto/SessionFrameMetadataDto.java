package com.example.backend.can.dto;

import java.util.List;

/**
 * Returned by GET /api/can/sessions/{sessionId}/metadata.
 * Provides the distinct filter options needed by the workspace UI
 * without loading all frames into memory.
 */
public record SessionFrameMetadataDto(
        String sessionId,
        List<String> msgIds,
        List<String> buses,
        List<MessageSummary> messages,
        List<String> signalNames
) {
    public record MessageSummary(String msgId, String msgName) {}
}
