package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDateTime;
import java.util.List;

/**
 * A raw integrity fault enriched with plain-English diagnostics resolved from the
 * knowledge base (subsystem, meaning, likely cause, what to check, severity) plus the
 * operating context captured around it. Preserves every original fault field so existing
 * consumers keep working; the enrichment fields are additive.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EnrichedFaultDto(
        Long id,
        String sessionId,
        Long frameId,
        String msgId,
        String msgName,
        String faultType,
        String description,
        Double frameTimestamp,
        LocalDateTime createdAt,
        // ── KB enrichment ──
        String subsystem,
        String title,
        String meaning,
        String likelyCause,
        String whatToCheck,
        int severity,
        List<FaultContextSignal> context,
        /** Id of the KB rule this fault resolved to — lets the UI open it for inline editing. */
        Long ruleId,
        /** Signal named by the fault (SIGNAL_RANGE only), for creating a signal-specific rule. */
        String signalName,
        // ── Findings layers (V8) — populated for REQUIREMENT-layer findings ──
        /** Detection layer: SPEC | REQUIREMENT | ML. */
        String layer,
        /** Rule id from the requirement file (REQUIREMENT layer only). */
        String requirementId,
        /** Rule severity CRITICAL|HIGH|MEDIUM|LOW|INFO (REQUIREMENT layer only). */
        String ruleSeverity,
        /** Repeat count of this exact finding within the session. */
        Integer occurrences,
        /** Frame timestamp (Unix seconds) of the most recent occurrence. */
        Double lastSeenTs,
        /** Parsed evidence JSON (trigger ts, deadline, latency…), null for SPEC faults. */
        Object evidence,
        /** Diagnostic check-list entries copied from the violated rule. */
        List<String> checkList,
        // ── Phase 5 fusion (V9) ──
        /** Root-cause cluster this finding belongs to, e.g. "Body & Comfort#1". */
        String clusterId,
        /**
         * Parsed correlation links: on a REQUIREMENT finding {"supportingMl":[…]},
         * on a boosted ML finding {"supportsFindingId":…, "requirementId":…}.
         */
        Object correlation
) {}
