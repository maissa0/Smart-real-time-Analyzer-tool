package com.example.backend.can.service;

import com.example.backend.can.dto.CatalogInfoDto;
import com.example.backend.can.dto.EnrichedFaultDto;
import com.example.backend.can.dto.FaultContextSignal;
import com.example.backend.can.dto.FindingClusterDto;
import com.example.backend.can.dto.IntegritySummaryDto;
import com.example.backend.can.entity.DiagnosticRuleEntity;
import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
@Slf4j
public class IntegrityService {

    private final IntegrityFaultRepository faultRepository;
    private final CatalogLoaderService catalogLoaderService;
    private final DiagnosticKbService diagnosticKbService;
    private final DiagnosticEnrichmentService enrichmentService;
    private final ObjectMapper objectMapper;

    // Signal-range fault descriptions start "Signal <name> value ..." — the only fault type
    // that names a signal. Others (duplicate/timing/counter) resolve by message/subsystem.
    private static final Pattern SIGNAL_NAME = Pattern.compile("Signal (\\S+)");

    /**
     * Return the session's faults, each enriched with plain-English KB diagnostics and the
     * operating context around it. Context missing on older sessions is back-filled from
     * InfluxDB (once) before resolving.
     */
    public List<EnrichedFaultDto> getFaults(String sessionId) {
        List<IntegrityFaultEntity> faults = faultRepository.findBySessionIdOrderByFrameTimestampAsc(sessionId);
        enrichmentService.backfillContext(sessionId, faults);
        return faults.stream().map(this::enrich).toList();
    }

    private EnrichedFaultDto enrich(IntegrityFaultEntity fault) {
        String signalName = parseSignalName(fault.getDescription());
        // Requirement-aware resolve (Phase 5): a REQUIREMENT-scope KB rule keyed
        // by the requirement id supplies the "What to check" guidance when present.
        Optional<DiagnosticRuleEntity> rule = diagnosticKbService.resolve(
                fault.getFaultType(), fault.getMsgName(), signalName, fault.getRequirementId());
        String subsystem = rule.map(DiagnosticRuleEntity::getSubsystem)
                .orElseGet(() -> diagnosticKbService.subsystemFor(fault.getMsgName()));

        return new EnrichedFaultDto(
                fault.getId(), fault.getSessionId(), fault.getFrameId(), fault.getMsgId(), fault.getMsgName(),
                fault.getFaultType(), fault.getDescription(), fault.getFrameTimestamp(), fault.getCreatedAt(),
                subsystem,
                rule.map(DiagnosticRuleEntity::getTitle).orElse(null),
                rule.map(DiagnosticRuleEntity::getMeaning).orElse(null),
                rule.map(DiagnosticRuleEntity::getLikelyCause).orElse(null),
                rule.map(DiagnosticRuleEntity::getWhatToCheck).orElse(null),
                rule.map(DiagnosticRuleEntity::getSeverityWeight).orElse(0),
                parseContext(fault.getContextJson()),
                rule.map(DiagnosticRuleEntity::getId).orElse(null),
                signalName,
                fault.getLayer(),
                fault.getRequirementId(),
                fault.getSeverity(),
                fault.getOccurrences(),
                fault.getLastSeenTs(),
                parseJson(fault.getEvidenceJson()),
                parseCheckList(fault.getCheckListJson()),
                fault.getClusterId(),
                parseJson(fault.getCorrelationJson()));
    }

    /**
     * Phase-5 root-cause clusters for a session: groups of 2+ findings sharing
     * a clusterId, ordered by window start. Built from the persisted rows so it
     * works for live and completed sessions alike.
     */
    public List<FindingClusterDto> getClusters(String sessionId) {
        Map<String, List<IntegrityFaultEntity>> byCluster = new LinkedHashMap<>();
        for (IntegrityFaultEntity f : faultRepository.findBySessionIdOrderByFrameTimestampAsc(sessionId)) {
            if (f.getClusterId() != null) {
                byCluster.computeIfAbsent(f.getClusterId(), k -> new ArrayList<>()).add(f);
            }
        }
        List<FindingClusterDto> out = new ArrayList<>();
        for (Map.Entry<String, List<IntegrityFaultEntity>> entry : byCluster.entrySet()) {
            List<IntegrityFaultEntity> members = entry.getValue();
            if (members.size() < 2) {
                continue; // a lone finding is just a finding
            }
            double start = members.stream()
                    .map(IntegrityFaultEntity::getFrameTimestamp)
                    .filter(Objects::nonNull).min(Double::compare).orElse(0.0);
            double end = members.stream()
                    .map(f -> f.getLastSeenTs() != null ? f.getLastSeenTs() : f.getFrameTimestamp())
                    .filter(Objects::nonNull).max(Double::compare).orElse(start);
            int totalOccurrences = members.stream()
                    .mapToInt(f -> f.getOccurrences() != null ? f.getOccurrences() : 1).sum();
            String subsystem = FindingCorrelationService.subsystemOf(entry.getKey());
            String topSeverity = topSeverity(members);
            String label = String.format(Locale.ROOT, "%s: %d findings in %.1fs",
                    subsystem, members.size(), Math.max(0.0, end - start));
            out.add(new FindingClusterDto(entry.getKey(), subsystem, members.size(),
                    totalOccurrences, start, end, topSeverity, label,
                    members.stream().map(IntegrityFaultEntity::getId).toList()));
        }
        out.sort(Comparator.comparing(FindingClusterDto::windowStart));
        return out;
    }

    private static final List<String> SEVERITY_ORDER =
            List.of("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO");

    /** Highest rule severity in the cluster; "SPEC" when only spec faults. */
    private String topSeverity(List<IntegrityFaultEntity> members) {
        for (String level : SEVERITY_ORDER) {
            for (IntegrityFaultEntity f : members) {
                if (level.equalsIgnoreCase(f.getSeverity())) {
                    return level;
                }
            }
        }
        return "SPEC";
    }

    /** Parse arbitrary JSON (evidence payload); null when absent or unparseable. */
    private Object parseJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (Exception e) {
            log.warn("Failed to parse finding evidence JSON: {}", e.getMessage());
            return null;
        }
    }

    private List<String> parseCheckList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse finding check-list JSON: {}", e.getMessage());
            return List.of();
        }
    }

    private String parseSignalName(String description) {
        if (description == null) {
            return null;
        }
        Matcher m = SIGNAL_NAME.matcher(description);
        return m.find() ? m.group(1) : null;
    }

    private List<FaultContextSignal> parseContext(String contextJson) {
        if (contextJson == null || contextJson.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(contextJson, new TypeReference<List<FaultContextSignal>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse fault context JSON: {}", e.getMessage());
            return List.of();
        }
    }

    public IntegritySummaryDto getSummary(String sessionId) {
        long totalFaults = faultRepository.countBySessionId(sessionId);
        return new IntegritySummaryDto(
                totalFaults,
                faultRepository.countBySessionIdAndFaultType(sessionId, "DUPLICATE"),
                faultRepository.countBySessionIdAndFaultType(sessionId, "TIMING_GAP"),
                faultRepository.countBySessionIdAndFaultType(sessionId, "SIGNAL_RANGE"),
                faultRepository.countBySessionIdAndFaultType(sessionId, "COUNTER_ERROR"),
                faultRepository.findDistinctMsgIdsBySessionId(sessionId),
                totalFaults == 0
        );
    }

    public CatalogInfoDto getCatalogInfo() {
        return new CatalogInfoDto(
                catalogLoaderService.getMessageSignalValidValues(),
                catalogLoaderService.getMessageCycleTimes()
        );
    }
}
