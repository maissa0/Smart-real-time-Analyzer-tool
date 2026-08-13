package com.example.backend.can.service;

import com.example.backend.can.dto.RequirementDtos.RequirementReportDto;
import com.example.backend.can.dto.RequirementDtos.RuleReportDto;
import com.example.backend.can.dto.SessionCompareResponse;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.influxdb.client.InfluxDBClient;
import com.influxdb.query.FluxRecord;
import com.influxdb.query.FluxTable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class SessionCompareService {

    private final CanSessionRepository canSessionRepository;
    private final CarRepository        carRepository;
    private final InfluxDBClient       influxDBClient;
    private final GroqClient           groqClient;
    private final RequirementMonitorService requirementMonitorService;

    @Value("${influxdb.org}")
    private String influxOrg;

    @Value("${groq.model:llama-3.3-70b-versatile}")
    private String model;

    private static final int MAX_SIGNALS = 40;

    // ── Public ────────────────────────────────────────────────────────────────

    public SessionCompareResponse compare(String sessionIdA, String sessionIdB) {
        CanSessionEntity sesA = canSessionRepository.findBySessionId(sessionIdA)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionIdA));
        CanSessionEntity sesB = canSessionRepository.findBySessionId(sessionIdB)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionIdB));

        String vehicleA = resolveVehicle(sesA);
        String vehicleB = resolveVehicle(sesB);

        Map<String, double[]> statsA = queryStats(sessionIdA);
        Map<String, double[]> statsB = queryStats(sessionIdB);

        // Time-aligned first-divergence per common signal (seconds from each
        // session's own start, so different recording dates still align).
        Map<String, Double> divergence = computeDivergence(
                querySeries(sessionIdA), querySeries(sessionIdB));

        List<String> onlyInA = new ArrayList<>();
        List<String> onlyInB = new ArrayList<>();
        List<SessionCompareResponse.SignalDiff> diffs = new ArrayList<>();

        Set<String> allSignals = new LinkedHashSet<>();
        allSignals.addAll(statsA.keySet());
        allSignals.addAll(statsB.keySet());

        for (String signal : allSignals) {
            boolean inA = statsA.containsKey(signal);
            boolean inB = statsB.containsKey(signal);
            if (inA && !inB) { onlyInA.add(signal); continue; }
            if (!inA)        { onlyInB.add(signal); continue; }

            double[] a = statsA.get(signal);
            double[] b = statsB.get(signal);
            double meanDeltaPct = Math.abs(a[0]) < 0.001
                    ? (Math.abs(b[0]) < 0.001 ? 0.0 : 100.0)
                    : (b[0] - a[0]) / Math.abs(a[0]) * 100.0;
            double stddevRatio = a[1] < 0.001
                    ? (b[1] < 0.001 ? 1.0 : 999.0)
                    : b[1] / a[1];

            diffs.add(new SessionCompareResponse.SignalDiff(
                    signal,
                    a[0], a[1], (long) a[2],
                    b[0], b[1], (long) b[2],
                    meanDeltaPct, stddevRatio,
                    classify(meanDeltaPct, stddevRatio),
                    divergence.get(signal)));
        }

        diffs.sort(Comparator.comparingDouble(d -> -Math.abs(d.meanDeltaPct())));

        List<SessionCompareResponse.RuleOutcomeDiff> ruleDiffs =
                compareRuleOutcomes(sessionIdA, sessionIdB);

        String analysis = generateAnalysis(sesA, sesB, vehicleA, vehicleB, diffs, onlyInA, onlyInB, ruleDiffs);

        return new SessionCompareResponse(
                sessionIdA, sessionIdB,
                sesA.getSourceFilename(), sesB.getSourceFilename(),
                vehicleA, vehicleB,
                diffs, onlyInA, onlyInB, ruleDiffs,
                analysis, model, Instant.now());
    }

    // ── Rule-by-rule requirement outcomes ─────────────────────────────────────

    /** Same rule id in both sessions → outcome pair; missing side reads N/A. */
    private List<SessionCompareResponse.RuleOutcomeDiff> compareRuleOutcomes(
            String sessionIdA, String sessionIdB) {
        RequirementReportDto ra = safeReport(sessionIdA);
        RequirementReportDto rb = safeReport(sessionIdB);
        if (ra == null && rb == null) return List.of();

        Map<String, RuleReportDto> mapA = indexRules(ra);
        Map<String, RuleReportDto> mapB = indexRules(rb);
        Set<String> ids = new LinkedHashSet<>();
        ids.addAll(mapA.keySet());
        ids.addAll(mapB.keySet());

        List<SessionCompareResponse.RuleOutcomeDiff> out = new ArrayList<>();
        for (String id : ids) {
            RuleReportDto a = mapA.get(id);
            RuleReportDto b = mapB.get(id);
            RuleReportDto ref = a != null ? a : b;
            String outcomeA = a != null ? a.outcome() : "N/A";
            String outcomeB = b != null ? b.outcome() : "N/A";
            out.add(new SessionCompareResponse.RuleOutcomeDiff(
                    id, ref.title(), ref.severity(), outcomeA, outcomeB,
                    !outcomeA.equals(outcomeB)));
        }
        // Changed outcomes first — they are what the tester is looking for.
        out.sort(Comparator.comparing((SessionCompareResponse.RuleOutcomeDiff d) -> !d.changed())
                .thenComparing(SessionCompareResponse.RuleOutcomeDiff::ruleId));
        return out;
    }

    private RequirementReportDto safeReport(String sessionId) {
        try {
            return requirementMonitorService.report(sessionId);
        } catch (Exception e) {
            log.warn("Requirement report unavailable for {}: {}", sessionId, e.getMessage());
            return null;
        }
    }

    private static Map<String, RuleReportDto> indexRules(RequirementReportDto report) {
        Map<String, RuleReportDto> map = new LinkedHashMap<>();
        if (report != null && report.rules() != null) {
            for (RuleReportDto r : report.rules()) map.putIfAbsent(r.ruleId(), r);
        }
        return map;
    }

    // ── Time-aligned divergence ───────────────────────────────────────────────

    /** Bucket width for time alignment (CAN state signals hold their value). */
    private static final double BUCKET_SEC = 0.5;
    private static final int MAX_SERIES_POINTS = 20_000;

    /**
     * First bucket (seconds from each session's own start) where a common
     * signal's held value differs materially between the two sessions.
     */
    private Map<String, Double> computeDivergence(
            Map<String, List<double[]>> serA, Map<String, List<double[]>> serB) {
        Map<String, Double> out = new HashMap<>();
        double t0A = earliestTime(serA);
        double t0B = earliestTime(serB);
        if (!Double.isFinite(t0A) || !Double.isFinite(t0B)) return out;

        for (Map.Entry<String, List<double[]>> e : serA.entrySet()) {
            List<double[]> b = serB.get(e.getKey());
            if (b == null || b.isEmpty() || e.getValue().isEmpty()) continue;
            Map<Long, Double> bucketsA = toBuckets(e.getValue(), t0A);
            Map<Long, Double> bucketsB = toBuckets(b, t0B);
            long last = Math.min(maxKey(bucketsA), maxKey(bucketsB));
            Double heldA = null, heldB = null;
            for (long k = 0; k <= last; k++) {
                if (bucketsA.containsKey(k)) heldA = bucketsA.get(k);
                if (bucketsB.containsKey(k)) heldB = bucketsB.get(k);
                if (heldA != null && heldB != null && differs(heldA, heldB)) {
                    out.put(e.getKey(), k * BUCKET_SEC);
                    break;
                }
            }
        }
        return out;
    }

    /** Material difference: >2% relative (floored at 1.0 so enum steps count). */
    private static boolean differs(double a, double b) {
        return Math.abs(a - b) > 0.02 * Math.max(1.0, Math.max(Math.abs(a), Math.abs(b)));
    }

    private static double earliestTime(Map<String, List<double[]>> series) {
        double min = Double.POSITIVE_INFINITY;
        for (List<double[]> pts : series.values()) {
            if (!pts.isEmpty() && pts.get(0)[0] < min) min = pts.get(0)[0];
        }
        return min;
    }

    /** Last value seen inside each bucket — hold-last semantics for state signals. */
    private static Map<Long, Double> toBuckets(List<double[]> points, double t0) {
        Map<Long, Double> buckets = new HashMap<>();
        for (double[] p : points) {
            long k = (long) Math.floor((p[0] - t0) / BUCKET_SEC);
            if (k >= 0) buckets.put(k, p[1]);
        }
        return buckets;
    }

    private static long maxKey(Map<Long, Double> m) {
        long max = 0;
        for (long k : m.keySet()) if (k > max) max = k;
        return max;
    }

    /** Time-ordered [epochSec, value] per signal for one session. */
    private Map<String, List<double[]>> querySeries(String sessionId) {
        String flux = """
                from(bucket: "ecu_telemetry")
                  |> range(start: 0)
                  |> filter(fn: (r) => r.session_id == "%s" and r._field == "value")
                  |> group(columns: ["signal_name"])
                  |> sort(columns: ["_time"])
                  |> limit(n: %d)
                """.formatted(sessionId, MAX_SERIES_POINTS);
        Map<String, List<double[]>> map = new LinkedHashMap<>();
        try {
            for (FluxTable table : influxDBClient.getQueryApi().query(flux, influxOrg)) {
                for (FluxRecord rec : table.getRecords()) {
                    Object name = rec.getValueByKey("signal_name");
                    Object val  = rec.getValue();
                    Instant time = rec.getTime();
                    if (name != null && time != null && val instanceof Number n) {
                        map.computeIfAbsent(name.toString(), k -> new ArrayList<>())
                           .add(new double[]{ time.toEpochMilli() / 1000.0, n.doubleValue() });
                    }
                }
            }
        } catch (Exception e) {
            log.warn("InfluxDB series query failed for session {}: {}", sessionId, e.getMessage());
        }
        return map;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private String classify(double meanDeltaPct, double stddevRatio) {
        boolean shifted  = Math.abs(meanDeltaPct) >= 20.0;
        boolean volatile_ = stddevRatio >= 2.0 || stddevRatio <= 0.5;
        if (shifted && volatile_) return "BOTH_CHANGED";
        if (shifted)              return "SHIFTED";
        if (volatile_)            return "VOLATILE";
        return "STABLE";
    }

    /** Returns Map<signalName, [mean, stddev, count]> via three InfluxDB aggregation queries. */
    private Map<String, double[]> queryStats(String sessionId) {
        Map<String, Double> means   = runAgg(sessionId, "mean()");
        Map<String, Double> stddevs = runAgg(sessionId, "stddev()");
        Map<String, Double> counts  = runAgg(sessionId, "count()");

        Map<String, double[]> result = new LinkedHashMap<>();
        for (String sig : means.keySet()) {
            result.put(sig, new double[]{
                    means.getOrDefault(sig, 0.0),
                    stddevs.getOrDefault(sig, 0.0),
                    counts.getOrDefault(sig, 0.0)
            });
        }
        return result;
    }

    private Map<String, Double> runAgg(String sessionId, String agg) {
        // range(start: 0), not -365d: uploaded logs with relative time axes store
        // their points at epoch 1970, far outside any recent window — a bounded
        // range made those sessions compare as "no signals at all".
        String flux = """
                from(bucket: "ecu_telemetry")
                  |> range(start: 0)
                  |> filter(fn: (r) => r.session_id == "%s" and r._field == "value")
                  |> group(columns: ["signal_name"])
                  |> %s
                  |> limit(n: %d)
                """.formatted(sessionId, agg, MAX_SIGNALS);

        Map<String, Double> map = new LinkedHashMap<>();
        try {
            for (FluxTable table : influxDBClient.getQueryApi().query(flux, influxOrg)) {
                for (FluxRecord rec : table.getRecords()) {
                    Object name = rec.getValueByKey("signal_name");
                    Object val  = rec.getValue();
                    if (name != null && val instanceof Number n) {
                        map.put(name.toString(), n.doubleValue());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("InfluxDB {} failed for session {}: {}", agg, sessionId, e.getMessage());
        }
        return map;
    }

    private String resolveVehicle(CanSessionEntity session) {
        if (session.getCarId() == null) return "Unknown Vehicle";
        return carRepository.findById(session.getCarId())
                .map(c -> c.getMake() + " " + c.getModel() + " " + c.getYear())
                .orElse("Unknown Vehicle");
    }

    private String generateAnalysis(
            CanSessionEntity sesA, CanSessionEntity sesB,
            String vehicleA, String vehicleB,
            List<SessionCompareResponse.SignalDiff> diffs,
            List<String> onlyInA, List<String> onlyInB,
            List<SessionCompareResponse.RuleOutcomeDiff> ruleDiffs) {

        long stable    = diffs.stream().filter(d -> "STABLE".equals(d.changeTag())).count();
        long shifted   = diffs.stream().filter(d -> "SHIFTED".equals(d.changeTag())).count();
        long volatile_ = diffs.stream().filter(d -> "VOLATILE".equals(d.changeTag())).count();
        long both      = diffs.stream().filter(d -> "BOTH_CHANGED".equals(d.changeTag())).count();

        StringBuilder ctx = new StringBuilder();
        ctx.append("SESSION A: ").append(sesA.getSourceFilename())
           .append(" | ").append(vehicleA)
           .append(" | ").append(sesA.getCreatedAt())
           .append(" | frames: ").append(sesA.getFrameCount()).append('\n');
        ctx.append("SESSION B: ").append(sesB.getSourceFilename())
           .append(" | ").append(vehicleB)
           .append(" | ").append(sesB.getCreatedAt())
           .append(" | frames: ").append(sesB.getFrameCount()).append('\n');
        ctx.append('\n');
        ctx.append("SUMMARY: ").append(diffs.size()).append(" common signals — ")
           .append(stable).append(" stable, ").append(shifted).append(" shifted, ")
           .append(volatile_).append(" volatile, ").append(both).append(" both\n\n");

        // %8s, not %+8s: the '+' flag is only legal on numeric conversions and
        // throws UnknownFormatConversionException on the header's string args.
        ctx.append(String.format("%-30s  %10s %10s  %10s %10s  %10s  %14s%n",
                "Signal", "A_mean", "A_σ", "B_mean", "B_σ", "change", "volatility"));
        ctx.append("-".repeat(100)).append('\n');
        // Sentinels translated to words so the model cannot quote them as data:
        // Δ=100% with A_mean≈0 means "was flat zero, became active"; ratio 999
        // means "was perfectly flat, now varies".
        diffs.stream().limit(20).forEach(d -> {
            String change = Math.abs(d.meanA()) < 0.001 && Math.abs(d.meanB()) >= 0.001
                    ? "became active"
                    : String.format("%+.1f%%", d.meanDeltaPct());
            String vol = d.stddevRatio() >= 999.0 ? "flat -> varies"
                    : d.stddevRatio() <= 0.001 ? "varies -> flat"
                    : String.format("%.2fx", d.stddevRatio());
            ctx.append(String.format("%-30s  %10.3f %10.3f  %10.3f %10.3f  %10s  %14s%n",
                    d.signalName(), d.meanA(), d.stddevA(),
                    d.meanB(), d.stddevB(), change, vol));
        });

        if (!onlyInA.isEmpty()) ctx.append("\nMISSING FROM B: ").append(String.join(", ", onlyInA)).append('\n');
        if (!onlyInB.isEmpty()) ctx.append("NEW IN B: ").append(String.join(", ", onlyInB)).append('\n');

        List<SessionCompareResponse.SignalDiff> diverged = diffs.stream()
                .filter(d -> d.divergedAtSec() != null).limit(10).toList();
        if (!diverged.isEmpty()) {
            ctx.append("\nFIRST DIVERGENCE (seconds from session start):\n");
            diverged.forEach(d -> ctx.append(String.format("  %-30s +%.1fs%n",
                    d.signalName(), d.divergedAtSec())));
        }

        List<SessionCompareResponse.RuleOutcomeDiff> changedRules = ruleDiffs.stream()
                .filter(SessionCompareResponse.RuleOutcomeDiff::changed).toList();
        if (!changedRules.isEmpty()) {
            ctx.append("\nREQUIREMENT OUTCOME CHANGES (rule: A -> B):\n");
            changedRules.forEach(r -> ctx.append(String.format("  %s (%s): %s -> %s%n",
                    r.ruleId(), r.severity(), r.outcomeA(), r.outcomeB())));
        }

        boolean sameVehicle = vehicleA != null && vehicleA.equals(vehicleB);
        String sysPrompt = """
                You are a senior automotive CAN bus diagnostic engineer writing for a test
                engineer who will read this in a test log. Compare two CAN recording sessions.
                %s
                Identify regressions (values worsening or becoming more volatile),
                improvements (signals stabilising), anomalies (signals appearing or
                disappearing), and the overall trend.
                Plain language: "became active" means the signal was flat zero in A and
                started changing in B — describe it that way, never as "+100%%" or a ratio.
                "flat -> varies" means it had no variation before and varies now.
                STRICT RULES: use ONLY numbers that appear in the data below — never invent
                percentages, estimates or accuracy figures. Do not speculate beyond the data.
                Write 3-4 short paragraphs. No bullet points. No section headers.
                """.formatted(sameVehicle
                ? "Both sessions come from the same vehicle."
                : "IMPORTANT: the sessions come from DIFFERENT vehicles/configurations ("
                  + vehicleA + " vs " + vehicleB + "). Do NOT describe differences as "
                  + "regressions of one car — signal and requirement differences largely "
                  + "reflect the different vehicle/catalog setup. Say this explicitly.");
        try {
            // Plain-text mode: the analysis is prose; Groq's json_object mode
            // rejects prompts that don't mention "json".
            return groqClient.complete(sysPrompt, ctx.toString(), false);
        } catch (Exception e) {
            log.error("LLM analysis failed: {}", e.getMessage());
            return "AI analysis unavailable: " + e.getMessage();
        }
    }
}