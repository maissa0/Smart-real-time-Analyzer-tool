package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

/**
 * The one authoritative session report: composes the requirements report, the
 * integrity findings (grouped by fault type), the probable-root-cause clusters,
 * the subsystem-grouped diagnostics, the AI summary (when one was generated)
 * and the vehicle context into a single payload. The Report tab renders it and
 * both PDF export paths print it — no analysis logic of its own, everything is
 * delegated to the existing services.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record FullReportDto(
        String sessionId,
        /** PASS | FAIL — fail when any SPEC fault or violated/timing-violated rule exists. */
        String overallVerdict,
        long specFaultCount,
        long requirementViolationCount,
        /** AI summary, null until the user generates one. */
        SessionSummaryDto summary,
        /** Per-rule requirements report; null when the session is unknown to the engine. */
        RequirementDtos.RequirementReportDto requirements,
        /** SPEC/ML-layer integrity findings grouped by fault type (worst types first). */
        Map<String, List<EnrichedFaultDto>> faultsByType,
        /** REQUIREMENT-layer findings (rule violations), severity-first. */
        List<EnrichedFaultDto> requirementFindings,
        List<FindingClusterDto> clusters,
        /** Subsystem-grouped diagnostic report (rule + AI verdicts per subsystem). */
        DiagnosticReportDto diagnostics,
        /** Representative operating context captured around the most severe fault. */
        List<FaultContextSignal> vehicleState,
        /** Display name of the session's car, e.g. "BMW 320i 2020"; null when unassigned. */
        String vehicle,
        /** The car's overall fault rate in % of frames, across all its sessions. */
        Double carFaultRate,
        /** Health of the car's previous sessions (newest first) — drives the trend. */
        List<SessionHealthPoint> history
) {

    /** One prior session of the same car, scored with the same health formula. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SessionHealthPoint(
            String sessionId,
            String createdAt,
            int healthScore,
            long faultCount,
            Integer frameCount
    ) {}
}
