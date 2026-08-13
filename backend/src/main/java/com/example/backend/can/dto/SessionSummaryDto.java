package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record SessionSummaryDto(
        String  sessionId,
        double  durationSec,
        String  narrative,
        String  networkHealth,
        String  faultAnalysis,
        List<String>   recommendations,
        List<KeyEvent> keyEvents,
        int     healthScore,
        String  healthGrade,
        List<SignalStat>  signalStats,
        FaultBreakdown    faultBreakdown,
        String  modelUsed,
        Instant generatedAt,
        int     signalCount,
        int     errorCount,
        /** Requirement rules the summary was based on — staleness/provenance (0 for legacy summaries). */
        int     ruleCount
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record KeyEvent(String time, String description) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SignalStat(
            String name,
            double min,
            double max,
            double mean,
            long   count
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FaultBreakdown(
            long  total,
            long  duplicates,
            long  timingGaps,
            long  rangeViolations,
            long  counterErrors,
            List<FaultPoint> timeline
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FaultPoint(double relTimeSec, String type) {}
}
