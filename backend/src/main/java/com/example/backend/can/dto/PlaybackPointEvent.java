package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One signal sample emitted over WebSocket during playback.
 *
 * value and signalName are the two fields the chart renderer depends on;
 * they use nullable wrappers so Jackson omits them when InfluxDB returns
 * no data for a tag rather than serialising a literal null that the
 * TypeScript interface cannot safely handle.
 *
 * @JsonInclude(NON_NULL) suppresses all null fields in the JSON payload,
 * keeping the WebSocket frame small and preventing the frontend from
 * mapping null to NaN or the string "null".
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PlaybackPointEvent(
        String type,
        String playbackId,
        String sessionId,
        double time,
        Double value,
        String signalName,
        String label,
        String msgId,
        String msgName,
        String channelName
) {}
