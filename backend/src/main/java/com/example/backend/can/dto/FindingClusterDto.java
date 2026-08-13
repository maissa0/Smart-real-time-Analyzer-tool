package com.example.backend.can.dto;

import java.util.List;

/**
 * One Phase-5 "probable root cause" cluster: findings that share an
 * ECU/subsystem within a short time window ("Body &amp; Comfort: 3 findings
 * in 2s"). Only clusters with 2+ findings are surfaced — a lone finding is
 * just a finding.
 */
public record FindingClusterDto(
        String clusterId,
        String subsystem,
        int findingCount,
        int totalOccurrences,
        Double windowStart,
        Double windowEnd,
        /** Highest severity in the cluster (CRITICAL..INFO, or SPEC when only spec faults). */
        String topSeverity,
        /** Ready-to-render summary, e.g. "Body &amp; Comfort: 3 findings in 1.4s". */
        String label,
        List<Long> findingIds
) {}
