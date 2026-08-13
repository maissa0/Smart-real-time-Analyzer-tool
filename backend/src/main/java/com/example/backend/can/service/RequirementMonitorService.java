package com.example.backend.can.service;

import com.example.backend.can.dto.RequirementDtos.RequirementReportDto;
import com.example.backend.can.dto.RequirementDtos.RuleReportDto;
import com.example.backend.can.dto.SignalData;
import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.entity.RequirementCoverageEntity;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.repository.RequirementCoverageRepository;
import com.example.backend.can.requirements.RequirementModel;
import com.example.backend.can.requirements.RequirementModel.RequirementFile;
import com.example.backend.can.requirements.RequirementModel.Rule;
import com.example.backend.can.requirements.RequirementSessionEngine;
import com.example.backend.can.requirements.RequirementSessionEngine.CoverageView;
import com.example.backend.can.requirements.RequirementSessionEngine.Finding;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Layer-2 requirements evaluation (docs/ANOMALY_REDESIGN_PLAN.md Phase 2).
 *
 * Runs INSIDE the same per-session analysis lane as IntegrityAnalyzerService
 * (CanKafkaConsumer submits both on one ordered task), so per-session engine
 * state has a single frame-driven writer; the scheduled deadline sweep is the
 * only other thread and synchronizes on the engine.
 *
 * Scoping is fully dynamic and per car: the session's car determines which
 * user-uploaded requirement files apply (snapshot at first frame). A car with
 * no assigned requirement sets has the engine OFF for its sessions — there is
 * deliberately no global fallback, because merging unrelated requirement sets
 * produces false violations.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RequirementMonitorService {

    private static final String LAYER_REQUIREMENT = "REQUIREMENT";

    private static final String OUTCOME_PASS = "PASS";
    private static final String OUTCOME_VIOLATED = "VIOLATED";
    private static final String OUTCOME_TIMING = "TIMING_VIOLATED";
    private static final String OUTCOME_NOT_TESTED = "NOT_TESTED";

    private final RequirementLoaderService requirementLoaderService;
    private final CanSessionRepository canSessionRepository;
    private final CarRepository carRepository;
    private final IntegrityFaultRepository faultRepository;
    private final RequirementCoverageRepository coverageRepository;
    private final FindingCorrelationService findingCorrelationService;
    private final DiagnosticKbService diagnosticKbService;
    private final ObjectMapper objectMapper;

    /**
     * engine == null means "resolved: requirements engine OFF for this session".
     * The snapshot is kept so findings can map rule-local signal names to
     * catalog names (signal_map / derived-signal sources) for Phase-5
     * subsystem clustering and KB seeding.
     */
    private record SessionCtx(RequirementSessionEngine engine,
                              Map<String, RequirementFile> snapshot) {}

    private final ConcurrentHashMap<String, SessionCtx> sessions = new ConcurrentHashMap<>();

    /** sessionId|ruleId|type -> persisted finding row id (occurrence dedup). */
    private final ConcurrentHashMap<String, Long> findingIdByDedupKey = new ConcurrentHashMap<>();

    /** Persist PASS counters every Nth 500ms sweep tick (~5s). */
    private static final int SNAPSHOT_EVERY_TICKS = 10;
    /** Only touched by the single-threaded @Scheduled sweep. */
    private long sweepTicks = 0;
    /** sessionId -> pass-count sum at last snapshot (skip unchanged writes). */
    private final ConcurrentHashMap<String, Long> lastSnapshotTotal = new ConcurrentHashMap<>();

    /** Evaluate one frame on the session's analysis lane (after integrity). */
    public void onFrame(CanFrameEntity frame, String signalsJson, double sessionStartTs) {
        String sessionId = frame.getSessionId();
        if (sessionId == null) {
            return;
        }
        SessionCtx ctx = resolveSession(sessionId);
        if (ctx == null || ctx.engine() == null) {
            return;
        }
        // Same absolute-seconds normalization as IntegrityAnalyzerService/Influx.
        double frameTs = frame.getTimestamp() != null ? frame.getTimestamp() : 0.0;
        double absoluteTs = frameTs > 1_000_000_000.0 ? frameTs : sessionStartTs + frameTs;

        List<Finding> findings =
                ctx.engine().onFrame(absoluteTs, System.nanoTime(), parseSignals(signalsJson));
        persistFindings(sessionId, ctx, findings);
    }

    /**
     * Arrival-clock fallback for armed deadlines: when a stream stops mid-
     * obligation no further frame can advance frame-time past the deadline,
     * so the sweep raises those violations from wall-clock silence instead.
     */
    @Scheduled(fixedDelay = 500)
    public void sweepDeadlines() {
        long now = System.nanoTime();
        sessions.forEach((sessionId, ctx) -> {
            if (ctx.engine() != null) {
                persistFindings(sessionId, ctx, ctx.engine().sweep(now));
            }
        });
        // Periodic PASS-counter snapshot (~5s). File replays never route
        // through completeSession (LogFileService marks them COMPLETE directly
        // via the repository), and a snapshot only at completion would also
        // lose everything on a hard kill mid-session — so persist from the
        // sweep, skipping sessions whose counters haven't changed.
        if (++sweepTicks % SNAPSHOT_EVERY_TICKS == 0) {
            sessions.keySet().forEach(this::snapshotCoverage);
        }
    }

    /** Persist one session's current PASS counters (idempotent replace). */
    private void snapshotCoverage(String sessionId) {
        SessionCtx ctx = sessions.get(sessionId);
        if (ctx == null || ctx.engine() == null) {
            return;
        }
        List<RequirementCoverageEntity> rows = new ArrayList<>();
        long total = 0;
        for (Map.Entry<Rule, String> entry : ctx.engine().ruleList()) {
            CoverageView cov = ctx.engine().coverageFor(entry.getKey().id());
            if (cov.pass() > 0) {
                total += cov.pass();
                rows.add(RequirementCoverageEntity.builder()
                        .sessionId(sessionId)
                        .requirementId(entry.getKey().id())
                        .passCount(cov.pass())
                        .build());
            }
        }
        // Pass totals only ever grow — an unchanged sum means nothing to write.
        if (rows.isEmpty() || total == lastSnapshotTotal.getOrDefault(sessionId, -1L)) {
            return;
        }
        lastSnapshotTotal.put(sessionId, total);
        coverageRepository.deleteBySessionId(sessionId);
        coverageRepository.saveAll(rows);
        log.debug("Persisted {} requirement PASS counter(s) for session: {}",
                rows.size(), sessionId);
    }

    /**
     * Session reached COMPLETE via session-meta (simulator path): snapshot the
     * per-rule PASS counters one last time before the engine is dropped, so
     * persistedReport() can still prove passes after a backend restart
     * (violations already persist as findings).
     */
    @Transactional
    public void completeSession(String sessionId) {
        lastSnapshotTotal.remove(sessionId); // force the final write
        snapshotCoverage(sessionId);
        clearSession(sessionId);
    }

    /** Session deleted: drop in-memory state and the persisted coverage snapshot. */
    @Transactional
    public void deleteSession(String sessionId) {
        coverageRepository.deleteBySessionId(sessionId);
        clearSession(sessionId);
    }

    /**
     * Drop all per-session engine state. Wired into the same lifecycle as
     * IntegrityAnalyzerService.clearSession (session COMPLETE + delete).
     */
    public void clearSession(String sessionId) {
        sessions.remove(sessionId);
        lastSnapshotTotal.remove(sessionId);
        String prefix = sessionId + "|";
        findingIdByDedupKey.keySet().removeIf(key -> key.startsWith(prefix));
        log.info("Cleared requirement monitor state for session: {}", sessionId);
    }

    // ── Report (docs plan §2.3) ──────────────────────────────────────────────

    /**
     * Per-rule outcome + coverage for one session; live from the engine while
     * the session runs, reconstructed from persisted findings afterwards.
     * Returns null when the session is unknown.
     */
    public RequirementReportDto report(String sessionId) {
        SessionCtx ctx = sessions.get(sessionId);
        if (ctx != null) {
            return liveReport(sessionId, ctx);
        }
        return persistedReport(sessionId);
    }

    private RequirementReportDto liveReport(String sessionId, SessionCtx ctx) {
        List<RuleReportDto> rows = new ArrayList<>();
        if (ctx.engine() != null) {
            for (Map.Entry<Rule, String> entry : ctx.engine().ruleList()) {
                Rule rule = entry.getKey();
                CoverageView cov = ctx.engine().coverageFor(rule.id());
                rows.add(ruleRow(rule, entry.getValue(),
                        cov.pass(), cov.violated(), cov.timingViolated()));
            }
        }
        return summarize(sessionId, true, rows);
    }

    /** Completed session: rule set from the car assignment, outcomes from DB findings. */
    private RequirementReportDto persistedReport(String sessionId) {
        CanSessionEntity session = canSessionRepository.findBySessionId(sessionId).orElse(null);
        if (session == null) {
            return null;
        }
        Map<String, RequirementFile> snapshot = session.getCarId() == null
                ? Map.of()
                : requirementLoaderService.snapshotFor(
                        carRepository.findRequirementFilenamesByCarId(session.getCarId()));

        Map<String, long[]> countsByRule = new HashMap<>(); // [violated, timingViolated]
        for (IntegrityFaultEntity f : faultRepository
                .findBySessionIdAndLayerOrderByFrameTimestampAsc(sessionId, LAYER_REQUIREMENT)) {
            if (f.getRequirementId() == null) {
                continue;
            }
            long[] counts = countsByRule.computeIfAbsent(f.getRequirementId(), k -> new long[2]);
            int occurrences = f.getOccurrences() != null ? f.getOccurrences() : 1;
            if (RequirementSessionEngine.TYPE_TIMING.equals(f.getFaultType())) {
                counts[1] += occurrences;
            } else {
                counts[0] += occurrences;
            }
        }

        // PASS counters are snapshotted at session completion (completeSession);
        // sessions completed before that snapshot existed simply report 0.
        Map<String, Long> passByRule = new HashMap<>();
        for (RequirementCoverageEntity cov : coverageRepository.findBySessionId(sessionId)) {
            passByRule.merge(cov.getRequirementId(), cov.getPassCount(), Long::sum);
        }

        List<RuleReportDto> rows = new ArrayList<>();
        for (Map.Entry<String, RequirementFile> file : snapshot.entrySet()) {
            for (Rule rule : file.getValue().rules()) {
                long[] counts = countsByRule.getOrDefault(rule.id(), new long[2]);
                rows.add(ruleRow(rule, file.getKey(),
                        passByRule.getOrDefault(rule.id(), 0L), counts[0], counts[1]));
            }
        }
        return summarize(sessionId, false, rows);
    }

    private RuleReportDto ruleRow(Rule rule, String sourceFile,
                                  long pass, long violated, long timingViolated) {
        String outcome;
        if (rule.draft()) {
            outcome = OUTCOME_NOT_TESTED; // draft rules never report a verdict
        } else if (violated > 0) {
            outcome = OUTCOME_VIOLATED;
        } else if (timingViolated > 0) {
            outcome = OUTCOME_TIMING;
        } else if (pass > 0) {
            outcome = OUTCOME_PASS;
        } else {
            outcome = OUTCOME_NOT_TESTED;
        }
        return new RuleReportDto(rule.id(), rule.title(), rule.severity().name(),
                rule.kind().name(), rule.draft(), sourceFile, outcome,
                pass, violated, timingViolated);
    }

    private RequirementReportDto summarize(String sessionId, boolean live,
                                           List<RuleReportDto> rows) {
        long exercised = rows.stream().filter(r ->
                r.passCount() + r.violatedCount() + r.timingViolatedCount() > 0).count();
        long passed = rows.stream().filter(r -> OUTCOME_PASS.equals(r.outcome())).count();
        long violated = rows.stream().filter(r -> OUTCOME_VIOLATED.equals(r.outcome())).count();
        long timing = rows.stream().filter(r -> OUTCOME_TIMING.equals(r.outcome())).count();
        long notTested = rows.stream().filter(r -> OUTCOME_NOT_TESTED.equals(r.outcome())).count();
        return new RequirementReportDto(sessionId, live, rows.size(),
                exercised, passed, violated, timing, notTested, rows);
    }

    // ── Session resolution ───────────────────────────────────────────────────

    /**
     * Resolve session -> car -> assigned requirement files -> engine, once per
     * session. The session row may not exist yet when the first frames arrive
     * (session-meta races the frame stream) — return null WITHOUT caching so a
     * later frame retries (same pattern as resolveCatalogScope).
     */
    private SessionCtx resolveSession(String sessionId) {
        SessionCtx cached = sessions.get(sessionId);
        if (cached != null) {
            return cached;
        }
        try {
            CanSessionEntity session = canSessionRepository.findBySessionId(sessionId).orElse(null);
            if (session == null) {
                return null;
            }
            List<String> filenames = session.getCarId() == null
                    ? List.of()
                    : carRepository.findRequirementFilenamesByCarId(session.getCarId());
            Map<String, RequirementFile> snapshot = filenames.isEmpty()
                    ? Map.of()
                    : requirementLoaderService.snapshotFor(filenames);

            SessionCtx ctx;
            if (snapshot.isEmpty()) {
                ctx = new SessionCtx(null, Map.of()); // engine off — no global fallback
                log.info("Session {}: no requirement sets assigned — engine off", sessionId);
            } else {
                RequirementSessionEngine engine = new RequirementSessionEngine(snapshot.values());
                ctx = new SessionCtx(engine, snapshot);
                log.info("Session {}: {} requirement rule(s) armed from {}",
                        sessionId, engine.ruleCount(), snapshot.keySet());
            }
            sessions.put(sessionId, ctx);
            return ctx;
        } catch (Exception e) {
            log.warn("Could not resolve requirement scope for session {}: {}",
                    sessionId, e.getMessage());
            return null;
        }
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    /** Insert findings; repeats collapse into occurrence increments (V6 dedup). */
    private void persistFindings(String sessionId, SessionCtx ctx, List<Finding> findings) {
        for (Finding f : findings) {
            try {
                String dedupKey = sessionId + "|" + f.rule().id() + "|" + f.type();
                Long existingId = findingIdByDedupKey.get(dedupKey);
                if (existingId != null) {
                    faultRepository.incrementOccurrences(existingId, f.ts());
                    continue;
                }
                IntegrityFaultEntity saved = faultRepository.save(toEntity(sessionId, f));
                findingIdByDedupKey.put(dedupKey, saved.getId());
                // Phase 5: seed the per-requirement KB entry (check-list is the
                // seed, users enrich) and hand the finding to the correlator.
                List<String> candidates = candidateSignals(ctx, f);
                diagnosticKbService.ensureRequirementRule(f.rule().id(), f.rule().title(),
                        f.rule().severity().name(), f.rule().checkList(),
                        diagnosticKbService.subsystemForSignals(candidates));
                findingCorrelationService.onFindingPersisted(saved, candidates);
                log.info("Requirement finding {} ({}) persisted for session {}",
                        f.rule().id(), f.type(), sessionId);
            } catch (Exception e) {
                log.error("Failed to persist requirement finding {} for session {}: {}",
                        f.rule().id(), sessionId, e.getMessage());
            }
        }
    }

    /**
     * Catalog signal names a rule touches: every rule-local name, mapped
     * through the file's signal_map; derived signals expand to their source
     * signals (a derived state is never on the bus, its inputs are).
     */
    private List<String> candidateSignals(SessionCtx ctx, Finding f) {
        Rule rule = f.rule();
        List<String> names = new ArrayList<>();
        if (rule.trigger() != null) {
            names.add(rule.trigger().signal());
        }
        if (rule.forbidden() != null) {
            names.add(rule.forbidden().signal());
        }
        if (rule.stateSignal() != null) {
            names.add(rule.stateSignal());
        }
        if (rule.expect() != null) {
            names.add(rule.expect().signal());
        }
        for (var p : rule.expectAll()) {
            names.add(p.signal());
        }
        for (var p : rule.preconditions()) {
            names.add(p.signal());
        }
        for (var p : rule.whileConds()) {
            names.add(p.signal());
        }

        RequirementFile file = ctx.snapshot().get(f.sourceFile());
        if (file == null) {
            return names.stream().filter(n -> n != null && !n.isBlank()).distinct().toList();
        }
        Map<String, RequirementModel.DerivedSignal> derivedByName = new HashMap<>();
        for (RequirementModel.DerivedSignal d : file.derivedSignals()) {
            derivedByName.put(d.name(), d);
        }
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String name : names) {
            if (name == null || name.isBlank()) {
                continue;
            }
            RequirementModel.DerivedSignal derived = derivedByName.get(name);
            if (derived != null) {
                for (String source : derived.from()) {
                    out.add(file.signalMap().getOrDefault(source, source));
                }
            } else {
                out.add(file.signalMap().getOrDefault(name, name));
            }
        }
        return List.copyOf(out);
    }

    private IntegrityFaultEntity toEntity(String sessionId, Finding f) {
        return IntegrityFaultEntity.builder()
                .sessionId(sessionId)
                .msgName(f.rule().id()) // msgName column carries the rule id
                .faultType(f.type())
                .description(f.description())
                .frameTimestamp(f.ts())
                .lastSeenTs(f.ts())
                .layer(LAYER_REQUIREMENT)
                .requirementId(f.rule().id())
                .severity(f.rule().severity().name())
                .evidenceJson(toJson(f.evidence()))
                .checkListJson(f.rule().checkList().isEmpty()
                        ? null : toJson(f.rule().checkList()))
                .build();
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            log.warn("Could not serialize finding payload: {}", e.getMessage());
            return null;
        }
    }

    private List<SignalData> parseSignals(String signalsJson) {
        if (signalsJson == null || signalsJson.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(signalsJson, new TypeReference<List<SignalData>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse signals JSON for requirement analysis: {}", e.getMessage());
            return List.of();
        }
    }
}
