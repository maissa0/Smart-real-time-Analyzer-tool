package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CanFramePayload(
        @JsonProperty("session_id")   String sessionId,
        @JsonProperty("timestamp")    Double timestamp,
        @JsonProperty("channel")      Integer channel,
        @JsonProperty("channel_name") String channelName,
        @JsonProperty("msg_id")       String msgId,
        @JsonProperty("msg_name")     String msgName,
        @JsonProperty("direction")    String direction,
        @JsonProperty("raw_bytes")    Object rawBytes,
        @JsonProperty("signals")      Object signals,
        @JsonProperty("frame_seq")    Integer frameSeq
) {}
