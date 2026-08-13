package com.example.backend.can.dto;

public record SignalTimelinePoint(
        String time,
        Object value,
        Object label,
        Object msgId,
        Object signalName
) {}
