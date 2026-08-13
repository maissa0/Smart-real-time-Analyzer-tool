package com.example.backend.can.dto;

public record PipelineStatsResponse(String sessionId, long mysqlFrames, long influxPoints) {}
