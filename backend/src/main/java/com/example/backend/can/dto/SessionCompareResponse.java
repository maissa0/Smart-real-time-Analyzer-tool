package com.example.backend.can.dto;

import java.time.Instant;
import java.util.List;

public record SessionCompareResponse(
        String        sessionIdA,
        String        sessionIdB,
        String        filenameA,
        String        filenameB,
        String        vehicleA,
        String        vehicleB,
        List<SignalDiff> diffs,
        List<String>  onlyInA,
        List<String>  onlyInB,
        List<RuleOutcomeDiff> ruleDiffs,
        String        analysis,
        String        modelUsed,
        Instant       generatedAt
) {
    public record SignalDiff(
            String signalName,
            double meanA, double stddevA, long countA,
            double meanB, double stddevB, long countB,
            double meanDeltaPct,
            double stddevRatio,
            String changeTag,
            /** Seconds from session start where A and B first differ; null = never / unknown. */
            Double divergedAtSec
    ) {}

    /** One requirement rule's outcome in each session (N/A when not evaluated). */
    public record RuleOutcomeDiff(
            String ruleId,
            String title,
            String severity,
            String outcomeA,
            String outcomeB,
            boolean changed
    ) {}
}
