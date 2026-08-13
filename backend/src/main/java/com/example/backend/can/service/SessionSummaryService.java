package com.example.backend.can.service;

import com.example.backend.can.dto.SessionSummaryDto;
import com.example.backend.can.dto.SessionSummaryDto.FaultBreakdown;
import com.example.backend.can.dto.SessionSummaryDto.FaultPoint;
import com.example.backend.can.dto.SessionSummaryDto.KeyEvent;
import com.example.backend.can.dto.SessionSummaryDto.SignalStat;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.entity.SessionSummary;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.repository.SessionSummaryRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.influxdb.client.InfluxDBClient;
import com.influxdb.query.FluxRecord;
import com.influxdb.query.FluxTable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
@Slf4j
public class SessionSummaryService {

    private final SessionSummaryRepository summaryRepository;
    private final CanSessionRepository     canSessionRepository;
    private final CarRepository            carRepository;
    private final IntegrityFaultRepository faultRepository;
    private final InfluxDBClient           influxDBClient;
    private final GroqClient               groqClient;
    private final ObjectMapper             objectMapper;
    private final DiagnosticKbService      diagnosticKbService;
    private final RequirementMonitorService requirementMonitorService;

    // Signal-range fault descriptions start "Signal <name> value ..." — used to resolve the
    // most specific KB rule when grounding the AI summary.
    private static final Pattern SIGNAL_NAME = Pattern.compile("Signal (\\S+)");

    @Value("${influxdb.bucket}")
    private String bucket;

    @Value("${influxdb.org}")
    private String influxOrg;

    @Value("${groq.model:llama-3.3-70b-versatile}")
    private String model;

    // ── Public API ────────────────────────────────────────────────────────────

    @Async
    public void generateAsync(String sessionId) {
        try {
            generateOrReplace(sessionId);
        } catch (Exception e) {
            log.error("Summary generation failed for session {}", sessionId, e);
        }
    }

    public void generateOrReplace(String sessionId) {
        summaryRepository.deleteById(sessionId);
        log.info("Generating summary for session {}", sessionId);
        SessionSummary summary = buildSummary(sessionId);
        summaryRepository.save(summary);
        log.info("Summary saved for session {}", sessionId);
    }

    public Optional<SessionSummaryDto> findBySessionId(String sessionId) {
        return summaryRepository.findById(sessionId).flatMap(entity -> {
            try {
                return Optional.of(objectMapper.readValue(entity.getReportText(), SessionSummaryDto.class));
            } catch (Exception e) {
                log.warn("Could not parse summary JSON for session {} — may be legacy plain-text format", sessionId);
                return Optional.empty();
            }
        });
    }

    public boolean exists(String sessionId) {
        return summaryRepository.existsById(sessionId);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private SessionSummary buildSummary(String sessionId) {
        CanSessionEntity session = canSessionRepository.findBySessionId(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        String vehicle    = resolveVehicle(session);
        // startTs/endTs are stored in Unix SECONDS (the session header computes its
        // duration from the same values without scaling) — dividing by 1000 here made
        // every report show "Duration 0s" while the header showed the real length.
        double durationSec = (session.getEndTs() != null && session.getStartTs() != null)
                ? (session.getEndTs() - session.getStartTs()) : 0;
        double sessionStartTs = session.getStartTs() != null ? session.getStartTs() : 0;

        // Override with InfluxDB-derived duration when the DB value looks wrong
        // (e.g. simulator set endTs = startTs + 3_600_000 ms before the session completed).
        double influxDuration = queryInfluxActualDuration(sessionId);
        if (influxDuration > 0 && influxDuration < durationSec) {
            durationSec = influxDuration;
        }

        List<SignalStat>           signalStats    = querySignalStats(sessionId);
        List<IntegrityFaultEntity> faults         = faultRepository.findBySessionIdOrderByFrameTimestampAsc(sessionId);
        FaultBreakdown             faultBreakdown = buildFaultBreakdown(faults, sessionStartTs);

        int    frameCount  = session.getFrameCount() != null ? session.getFrameCount() : 0;
        int    healthScore = healthScore(faults.size(), frameCount);
        String healthGrade = gradeFromScore(healthScore);
        int    ruleCount   = resolveRuleCount(sessionId);

        String    context = buildLlmContext(session, vehicle, durationSec, signalStats, faultBreakdown, faults);
        LlmFields llm     = callLlm(context, vehicle);

        SessionSummaryDto dto = new SessionSummaryDto(
                sessionId,
                durationSec,
                llm.narrative(),
                llm.networkHealth(),
                llm.faultAnalysis(),
                llm.recommendations(),
                llm.keyEvents(),
                healthScore,
                healthGrade,
                signalStats,
                faultBreakdown,
                model,
                Instant.now(),
                signalStats.size(),
                faults.size(),
                ruleCount
        );

        String reportJson;
        try {
            reportJson = objectMapper.writeValueAsString(dto);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to serialize summary DTO", e);
        }

        return SessionSummary.builder()
                .sessionId(sessionId)
                .reportText(reportJson)
                .modelUsed(model)
                .signalCount(signalStats.size())
                .errorCount(faults.size())
                .generatedAt(Instant.now())
                .build();
    }

    /** Rule count the summary is based on — persisted for staleness detection. */
    private int resolveRuleCount(String sessionId) {
        try {
            var report = requirementMonitorService.report(sessionId);
            return report != null ? report.totalRules() : 0;
        } catch (Exception e) {
            log.warn("Could not resolve rule count for session {}: {}", sessionId, e.getMessage());
            return 0;
        }
    }

    private String resolveVehicle(CanSessionEntity session) {
        if (session.getCarId() == null) return "Unknown Vehicle";
        return carRepository.findById(session.getCarId())
                .map(c -> c.getMake() + " " + c.getModel() + " " + c.getYear())
                .orElse("Unknown Vehicle");
    }

    /**
     * Single Flux reduce query — computes min/max/sum/count per signal in one round-trip.
     * Mean is derived in Java as sum/count.
     */
    private double queryInfluxActualDuration(String sessionId) {
        try {
            String firstFlux = String.format("""
                    from(bucket: "%s")
                      |> range(start: 0)
                      |> filter(fn: (r) => r["_measurement"] == "can_signals")
                      |> filter(fn: (r) => r["session_id"] == "%s")
                      |> filter(fn: (r) => r["_field"] == "value")
                      |> first()
                    """, bucket, sessionId);
            String lastFlux = String.format("""
                    from(bucket: "%s")
                      |> range(start: 0)
                      |> filter(fn: (r) => r["_measurement"] == "can_signals")
                      |> filter(fn: (r) => r["session_id"] == "%s")
                      |> filter(fn: (r) => r["_field"] == "value")
                      |> last()
                    """, bucket, sessionId);

            // first()/last() return one row PER SERIES (per signal) — the session's
            // real span is the EARLIEST first across series to the LATEST last.
            // Taking iteration-order rows here understated the duration whenever
            // the first-iterated signal started transmitting late.
            Instant firstTime = null;
            Instant lastTime  = null;
            for (FluxTable t : influxDBClient.getQueryApi().query(firstFlux, influxOrg))
                for (FluxRecord r : t.getRecords()) {
                    Instant time = r.getTime();
                    if (time != null && (firstTime == null || time.isBefore(firstTime))) firstTime = time;
                }
            for (FluxTable t : influxDBClient.getQueryApi().query(lastFlux, influxOrg))
                for (FluxRecord r : t.getRecords()) {
                    Instant time = r.getTime();
                    if (time != null && (lastTime == null || time.isAfter(lastTime))) lastTime = time;
                }

            if (firstTime != null && lastTime != null && lastTime.isAfter(firstTime))
                return (lastTime.toEpochMilli() - firstTime.toEpochMilli()) / 1000.0;
        } catch (Exception e) {
            log.warn("Could not determine InfluxDB actual duration for session {}: {}", sessionId, e.getMessage());
        }
        return -1;
    }

    private List<SignalStat> querySignalStats(String sessionId) {
        String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["_field"] == "value")
                  |> toFloat()
                  |> group(columns: ["signal_name"])
                  |> reduce(
                      identity: {sum: 0.0, count: 0, min: 9999999.0, max: -9999999.0},
                      fn: (r, accumulator) => ({
                          sum: accumulator.sum + r._value,
                          count: accumulator.count + 1,
                          min: if r._value < accumulator.min then r._value else accumulator.min,
                          max: if r._value > accumulator.max then r._value else accumulator.max
                      })
                  )
                """, bucket, sessionId);

        List<SignalStat> stats = new ArrayList<>();
        try {
            List<FluxTable> tables = influxDBClient.getQueryApi().query(flux, influxOrg);
            for (FluxTable table : tables) {
                for (FluxRecord record : table.getRecords()) {
                    String name  = asString(record.getValueByKey("signal_name"));
                    Number count = toNumber(record.getValueByKey("count"));
                    Number sum   = toNumber(record.getValueByKey("sum"));
                    Number min   = toNumber(record.getValueByKey("min"));
                    Number max   = toNumber(record.getValueByKey("max"));
                    if (name == null || count == null || sum == null || min == null || max == null) continue;
                    long   cnt  = count.longValue();
                    double mean = cnt > 0 ? sum.doubleValue() / cnt : 0.0;
                    stats.add(new SignalStat(name, min.doubleValue(), max.doubleValue(), mean, cnt));
                }
            }
        } catch (Exception e) {
            log.warn("Signal stats query failed for {}: {}", sessionId, e.getMessage());
        }
        stats.sort(Comparator.comparingLong(SignalStat::count).reversed());
        return stats.size() > 30 ? stats.subList(0, 30) : stats;
    }

    private FaultBreakdown buildFaultBreakdown(List<IntegrityFaultEntity> faults, double sessionStartTs) {
        long total           = faults.size();
        long duplicates      = faults.stream().filter(f -> "DUPLICATE".equals(f.getFaultType())).count();
        long timingGaps      = faults.stream().filter(f -> "TIMING_GAP".equals(f.getFaultType())).count();
        long rangeViolations = faults.stream().filter(f -> "SIGNAL_RANGE".equals(f.getFaultType())).count();
        long counterErrors   = faults.stream().filter(f -> "COUNTER_ERROR".equals(f.getFaultType())).count();

        List<FaultPoint> timeline = faults.stream()
                .filter(f -> f.getFrameTimestamp() != null)
                .map(f -> new FaultPoint(f.getFrameTimestamp() - sessionStartTs, f.getFaultType()))
                .toList();

        return new FaultBreakdown(total, duplicates, timingGaps, rangeViolations, counterErrors, timeline);
    }

    /** Shared with FullReportService so prior-session trend points use the same formula. */
    public static int healthScore(int faultCount, int frameCount) {
        int score = 100;
        if (frameCount > 0) {
            double faultRate = (double) faultCount / frameCount;
            if      (faultRate >= 0.10) score -= 40;
            else if (faultRate >= 0.01) score -= 20;
            else if (faultRate >  0)    score -= 5;
        }
        score -= Math.min(20, faultCount / 5);
        return Math.max(0, score);
    }

    private String gradeFromScore(int score) {
        if (score >= 90) return "A";
        if (score >= 75) return "B";
        if (score >= 60) return "C";
        if (score >= 40) return "D";
        return "F";
    }

    private String buildLlmContext(CanSessionEntity session, String vehicle,
                                   double durationSec, List<SignalStat> signalStats,
                                   FaultBreakdown faultBreakdown, List<IntegrityFaultEntity> faults) {
        long min = (long) (durationSec / 60);
        long sec = (long) (durationSec % 60);

        StringBuilder sb = new StringBuilder();
        sb.append("SESSION CONTEXT:\n");
        sb.append("Vehicle        : ").append(vehicle).append('\n');
        sb.append("Source File    : ").append(
                session.getSourceFilename() != null ? session.getSourceFilename() : "N/A").append('\n');
        sb.append("Duration       : ").append(min).append(" min ").append(sec).append(" sec\n");
        sb.append("Max key event time: +").append(min).append(":").append(String.format("%02d", sec)).append(".0\n");
        sb.append("Total Frames   : ").append(
                session.getFrameCount() != null ? session.getFrameCount() : "N/A").append('\n');
        sb.append("Recorded       : ").append(session.getCreatedAt()).append('\n');

        sb.append("\nSIGNAL STATISTICS (").append(signalStats.size()).append(" signals):\n");
        for (SignalStat s : signalStats) {
            // Locale.ROOT: a French-locale JVM would print "mean=18,050" and the LLM
            // reads the comma as a thousands separator, inventing values 1000× too big.
            sb.append(String.format(Locale.ROOT, "  %-30s  count=%d  min=%.3f  max=%.3f  mean=%.3f%n",
                    s.name(), s.count(), s.min(), s.max(), s.mean()));
        }

        sb.append("\nFAULT SUMMARY:\n");
        sb.append("  Total faults     : ").append(faultBreakdown.total()).append('\n');
        sb.append("  Duplicates       : ").append(faultBreakdown.duplicates()).append('\n');
        sb.append("  Timing gaps      : ").append(faultBreakdown.timingGaps()).append('\n');
        sb.append("  Range violations : ").append(faultBreakdown.rangeViolations()).append('\n');
        sb.append("  Counter errors   : ").append(faultBreakdown.counterErrors()).append('\n');
        // MESSAGE_TIMEOUT (and other types outside the breakdown categories) would otherwise
        // leave the per-type lines all 0 while the total is not — the LLM then writes
        // "no faults were found" next to a non-empty findings list.
        long messageTimeouts = faults.stream()
                .filter(f -> "MESSAGE_TIMEOUT".equals(f.getFaultType())).count();
        sb.append("  Message timeouts : ").append(messageTimeouts).append('\n');

        sb.append(buildKbGrounding(faults));

        return sb.toString();
    }

    /**
     * Resolve each present fault to its knowledge-base rule and list the distinct
     * subsystem/fault-type diagnostics (meaning + what-to-check). Deduped so the prompt stays
     * short. This is what the AI must ground its fault analysis in, instead of inventing.
     */
    private String buildKbGrounding(List<IntegrityFaultEntity> faults) {
        if (faults.isEmpty()) {
            return "";
        }
        // Dedupe by "subsystem|faultType"; keep meaning + what-to-check from the resolved rule.
        LinkedHashMap<String, String[]> seen = new LinkedHashMap<>();
        for (IntegrityFaultEntity f : faults) {
            String signalName = parseSignalName(f.getDescription());
            diagnosticKbService.resolve(f.getFaultType(), f.getMsgName(), signalName).ifPresent(rule ->
                    seen.putIfAbsent(rule.getSubsystem() + "|" + f.getFaultType(),
                            new String[]{rule.getSubsystem(), f.getFaultType(),
                                    rule.getMeaning(), rule.getWhatToCheck()}));
        }
        if (seen.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder(
                "\nKNOWLEDGE-BASE DIAGNOSTICS (ground your fault analysis in these — do not invent):\n");
        for (String[] v : seen.values()) {
            sb.append("  [").append(v[0]).append(" / ").append(v[1]).append("] ")
              .append(v[2] != null ? v[2] : "")
              .append(" Check: ").append(v[3] != null ? v[3] : "").append('\n');
        }
        return sb.toString();
    }

    private static String parseSignalName(String description) {
        if (description == null) {
            return null;
        }
        Matcher m = SIGNAL_NAME.matcher(description);
        return m.find() ? m.group(1) : null;
    }

    private record LlmFields(
            String narrative,
            String networkHealth,
            String faultAnalysis,
            List<String> recommendations,
            List<KeyEvent> keyEvents) {}

    private LlmFields callLlm(String context, String vehicle) {
        String systemPrompt = String.format("""
                You are a senior automotive CAN bus diagnostics engineer analyzing a %s.
                Given the telemetry session data below, return ONLY a valid JSON object \
                (no markdown, no code fences) with exactly these keys:
                {
                  "narrative": "2-3 paragraphs in plain English telling the story of what the vehicle \
                was doing during this recording (e.g. pulled away, doors opened, wipers ran). INTERPRET \
                the signals — never recite per-signal statistics or phrases like 'a mean of X' or \
                'a value of Y on average'. Mention at most 3-4 rounded values, only where they support \
                the story (e.g. 'reached about 60 km/h'). Write so a car owner can understand it.",
                  "networkHealth": "1 paragraph assessing the CAN bus network quality: \
                message timing consistency, duplicate rate, bus load, timing irregularities.",
                  "faultAnalysis": "1-2 paragraphs explaining the faults found. For each type present \
                (DUPLICATE, TIMING_GAP, SIGNAL_RANGE, COUNTER_ERROR, MESSAGE_TIMEOUT), explain in plain English what it \
                means and its likely cause. When KNOWLEDGE-BASE DIAGNOSTICS are provided in the context, \
                ground your explanation and recommendations strictly in them — do not invent ECU names, \
                wiring, or causes that are not listed.",
                  "recommendations": ["concrete action item 1", "concrete action item 2"],
                  "keyEvents": [{"time": "+M:SS.s", "description": "brief description with specific values"}]
                Timestamps in keyEvents MUST be within the session duration. \
                Never generate a keyEvent time that exceeds the "Max key event time" in the context.
                }
                Use only the data provided. Do not invent signal names or values.
                Return only the JSON object, nothing else.
                """, vehicle);

        String rawResponse = groqClient.complete(systemPrompt, context);

        try {
            String cleaned = rawResponse.strip();
            if (cleaned.startsWith("```")) {
                cleaned = cleaned.replaceAll("(?s)^```[a-z]*\\s*", "").replaceAll("```\\s*$", "").strip();
            }

            JsonNode root = objectMapper.readTree(cleaned);

            String narrative     = root.path("narrative").asText("No narrative generated.");
            String networkHealth = root.path("networkHealth").asText("");
            String faultAnalysis = root.path("faultAnalysis").asText("");

            List<String> recommendations = new ArrayList<>();
            root.path("recommendations").forEach(n -> recommendations.add(n.asText()));

            List<KeyEvent> keyEvents = new ArrayList<>();
            root.path("keyEvents").forEach(n ->
                    keyEvents.add(new KeyEvent(n.path("time").asText(), n.path("description").asText())));

            return new LlmFields(narrative, networkHealth, faultAnalysis, recommendations, keyEvents);

        } catch (Exception e) {
            log.warn("Failed to parse LLM JSON response, using raw text as narrative: {}", e.getMessage());
            return new LlmFields(rawResponse, "", "", List.of(), List.of());
        }
    }

    private static String asString(Object v) {
        return v != null ? v.toString() : null;
    }

    private static Number toNumber(Object v) {
        if (v instanceof Number n) return n;
        if (v instanceof String s) {
            try { return Double.parseDouble(s); } catch (NumberFormatException ignored) { return null; }
        }
        return null;
    }
}
