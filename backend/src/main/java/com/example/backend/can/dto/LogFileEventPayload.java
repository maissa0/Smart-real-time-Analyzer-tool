package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record LogFileEventPayload(
        @JsonProperty("session_id")       String sessionId,
        @JsonProperty("event")            String event,
        @JsonProperty("filename")         String filename,
        @JsonProperty("file_size")        Long fileSize,
        @JsonProperty("format")           String format,
        @JsonProperty("channel_count")    Integer channelCount,
        @JsonProperty("frame_count")      Integer frameCount,
        @JsonProperty("start_ts")         Double startTs,
        @JsonProperty("end_ts")           Double endTs,
        @JsonProperty("duration_seconds") Double durationSeconds,
        @JsonProperty("error")            String error
) {}
