package com.example.backend.can.service;

import com.example.backend.can.dto.DiagnosticReportDto;
import com.example.backend.can.dto.DiagnosticReportDto.SubsystemReport;
import com.example.backend.can.dto.EnrichedFaultDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Builds the subsystem-grouped diagnostic report: groups a session's enriched faults by
 * subsystem and gives each group two verdicts side by side — a deterministic rule verdict
 * (from fault types + summed severity) and an AI verdict grounded strictly in the knowledge
 * base so the model stops inventing ECU/wiring details.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DiagnosticReportService {

    private final IntegrityService integrityService;
    private final GroqClient groqClient;
    private final ObjectMapper objectMapper;

    private static final String DEFAULT_SUBSYSTEM = "General";
    private static final int NEEDS_ATTENTION_SEVERITY = 4;
    private static final Pattern SIGNAL_NAME = Pattern.compile("Signal (\\S+)");

    private static final String CRITICAL = "Critical";
    private static final String NEEDS_ATTENTION = "Needs attention";
    private static final String ADVISORY = "Advisory";
    private static final String HEALTHY = "Healthy";

    public DiagnosticReportDto buildReport(String sessionId) {
        List<EnrichedFaultDto> faults = integrityService.getFaults(sessionId);

        Map<String, List<EnrichedFaultDto>> bySubsystem = new LinkedHashMap<>();
        for (EnrichedFaultDto f : faults) {
            String sub = (f.subsystem() != null && !f.subsystem().isBlank()) ? f.subsystem() : DEFAULT_SUBSYSTEM;
            bySubsystem.computeIfAbsent(sub, k -> new ArrayList<>()).add(f);
        }

        Map<String, String> aiVerdicts = fetchAiVerdicts(sessionId, bySubsystem);

        List<SubsystemReport> reports = new ArrayList<>();
        for (var entry : bySubsystem.entrySet()) {
            String sub = entry.getKey();
            List<EnrichedFaultDto> subFaults = entry.getValue();
            int severityScore = subFaults.stream().mapToInt(EnrichedFaultDto::severity).sum();
            List<String> checks = subFaults.stream()
                    .map(EnrichedFaultDto::whatToCheck).filter(Objects::nonNull).distinct().toList();
            reports.add(new SubsystemReport(
                    sub, ruleVerdict(subFaults), aiVerdicts.get(sub),
                    severityScore, subFaults.size(), subFaults, checks, implicatedSignals(subFaults)));
        }

        // Worst subsystems first, then by summed severity.
        reports.sort(Comparator.comparingInt((SubsystemReport r) -> verdictRank(r.ruleVerdict()))
                .thenComparingInt(SubsystemReport::severityScore).reversed());

        String overall = reports.stream()
                .map(SubsystemReport::ruleVerdict)
                .max(Comparator.comparingInt(this::verdictRank))
                .orElse(HEALTHY);

        return new DiagnosticReportDto(sessionId, faults.size(), overall, reports);
    }

    // ── Deterministic verdict ───────────────────────────────────────────────────

    private String ruleVerdict(List<EnrichedFaultDto> faults) {
        if (faults.isEmpty()) {
            return HEALTHY;
        }
        if (faults.stream().anyMatch(f -> "SIGNAL_RANGE".equals(f.faultType()))) {
            return CRITICAL;
        }
        boolean counterOrTiming = faults.stream()
                .anyMatch(f -> "COUNTER_ERROR".equals(f.faultType()) || "TIMING_GAP".equals(f.faultType()));
        int severity = faults.stream().mapToInt(EnrichedFaultDto::severity).sum();
        if (counterOrTiming || severity >= NEEDS_ATTENTION_SEVERITY) {
            return NEEDS_ATTENTION;
        }
        return ADVISORY; // duplicates only
    }

    private int verdictRank(String verdict) {
        return switch (verdict == null ? "" : verdict) {
            case CRITICAL -> 3;
            case NEEDS_ATTENTION -> 2;
            case ADVISORY -> 1;
            default -> 0; // Healthy / unknown
        };
    }

    /** The genuinely non-nominal signals in a subsystem — those named by SIGNAL_RANGE faults. */
    private List<String> implicatedSignals(List<EnrichedFaultDto> faults) {
        Set<String> names = new LinkedHashSet<>();
        for (EnrichedFaultDto f : faults) {
            if (!"SIGNAL_RANGE".equals(f.faultType()) || f.description() == null) {
                continue;
            }
            Matcher m = SIGNAL_NAME.matcher(f.description());
            if (m.find()) {
                names.add(m.group(1));
            }
        }
        return new ArrayList<>(names);
    }

    // ── Grounded AI verdicts ────────────────────────────────────────────────────

    private Map<String, String> fetchAiVerdicts(String sessionId, Map<String, List<EnrichedFaultDto>> bySubsystem) {
        if (bySubsystem.isEmpty()) {
            return Map.of();
        }
        try {
            String system = """
                    You are a senior automotive diagnostics engineer. For each vehicle subsystem below,
                    write ONE short plain-English health-verdict sentence a car owner can understand.
                    Use ONLY the diagnostics provided — do NOT invent ECU names, wiring, part numbers,
                    or causes that are not listed. Return ONLY a JSON object whose keys are the exact
                    subsystem names given and whose values are the verdict sentences, e.g.
                    {"Chassis & Braking": "..."}.
                    """;
            String response = groqClient.complete(system, buildVerdictContext(bySubsystem));
            return parseVerdicts(response, bySubsystem.keySet());
        } catch (Exception e) {
            log.warn("Grounded AI verdicts unavailable for session {} (using deterministic only): {}",
                    sessionId, e.getMessage());
            return Map.of();
        }
    }

    private String buildVerdictContext(Map<String, List<EnrichedFaultDto>> bySubsystem) {
        StringBuilder sb = new StringBuilder("SUBSYSTEM DIAGNOSTICS (grounded — use only this):\n");
        for (var entry : bySubsystem.entrySet()) {
            List<EnrichedFaultDto> faults = entry.getValue();
            sb.append("\nSUBSYSTEM: ").append(entry.getKey()).append('\n');
            sb.append("  Fault counts: ").append(faultTypeCounts(faults)).append('\n');

            faults.stream().map(EnrichedFaultDto::meaning).filter(Objects::nonNull).distinct().limit(3)
                    .forEach(m -> sb.append("  Means: ").append(m).append('\n'));
            faults.stream().map(EnrichedFaultDto::whatToCheck).filter(Objects::nonNull).distinct().limit(3)
                    .forEach(c -> sb.append("  Check: ").append(c).append('\n'));
        }
        return sb.toString();
    }

    private String faultTypeCounts(List<EnrichedFaultDto> faults) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (EnrichedFaultDto f : faults) {
            counts.merge(f.faultType(), 1, Integer::sum);
        }
        StringBuilder sb = new StringBuilder();
        for (var e : counts.entrySet()) {
            if (sb.length() > 0) sb.append(", ");
            sb.append(e.getKey()).append(" x").append(e.getValue());
        }
        return sb.toString();
    }

    private Map<String, String> parseVerdicts(String response, Set<String> subsystems) {
        Map<String, String> out = new LinkedHashMap<>();
        try {
            String cleaned = response.strip();
            if (cleaned.startsWith("```")) {
                cleaned = cleaned.replaceAll("(?s)^```[a-z]*\\s*", "").replaceAll("```\\s*$", "").strip();
            }
            JsonNode root = objectMapper.readTree(cleaned);
            for (Iterator<String> it = root.fieldNames(); it.hasNext(); ) {
                String key = it.next();
                if (subsystems.contains(key)) {
                    out.put(key, root.path(key).asText());
                }
            }
        } catch (Exception e) {
            log.warn("Could not parse AI verdict JSON: {}", e.getMessage());
        }
        return out;
    }
}
