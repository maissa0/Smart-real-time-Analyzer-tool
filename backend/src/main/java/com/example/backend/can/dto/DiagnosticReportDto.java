package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * Subsystem-grouped diagnostic report for a session: enriched faults grouped by owning
 * subsystem, each group carrying two side-by-side verdicts — a deterministic rule verdict
 * (from summed severity) and an AI verdict grounded in the knowledge base — plus the checks
 * to perform and the signals implicated.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DiagnosticReportDto(
        String sessionId,
        int totalFaults,
        String overallVerdict,
        List<SubsystemReport> subsystems
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SubsystemReport(
            String subsystem,
            String ruleVerdict,
            String aiVerdict,
            int severityScore,
            int faultCount,
            List<EnrichedFaultDto> faults,
            List<String> checks,
            List<String> implicatedSignals
    ) {}
}
