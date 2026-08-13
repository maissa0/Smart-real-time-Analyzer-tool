package com.example.backend.can.dto;

import java.util.List;

public record IntegritySummaryDto(
        long totalFaults,
        long duplicates,
        long timingGaps,
        long signalRangeViolations,
        long counterErrors,
        List<String> affectedMsgIds,
        boolean healthy
) {}
