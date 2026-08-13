package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CanSessionPayload(
        @JsonProperty("session_id")      String sessionId,
        @JsonProperty("status")          String status,
        @JsonProperty("source_filename") String sourceFilename,
        @JsonProperty("start_ts")        Double startTs,
        @JsonProperty("end_ts")          Double endTs,
        @JsonProperty("frame_count")     Integer frameCount,
        @JsonProperty("car_uid")         String carUid
) {}
