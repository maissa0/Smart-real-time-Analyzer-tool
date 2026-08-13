package com.example.backend.can.service;

import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.dto.FaultContextSignal;
import com.example.backend.can.dto.SignalData;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Layer-1 spec-conformance checks (see docs/ANOMALY_REDESIGN_PLAN.md).
 *
 * Runs on the {@link AnalysisExecutorService} per-session lane, so for one
 * session there is exactly one writer thread and frames arrive in Kafka order.
 * The scheduled sweeper is the only other thread touching state — it reads
 * fields and flips the per-message timeout latch, nothing else.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class IntegrityAnalyzerService {

    private final IntegrityFaultRepository faultRepository;
    private final CatalogLoaderService catalogLoaderService;
    private final ObjectMapper objectMapper;
    private final CanSessionRepository canSessionRepository;
    private final CarRepository carRepository;
    private final FindingCorrelationService findingCorrelationService;

    // Minimum gap in seconds below which identical frames are duplicates
    private static final double MIN_INTERVAL_SECONDS = 0.001;
    // Multiplier on cycle time to determine max allowed gap (3x cycle = late by 2 full cycles)
    private static final double GAP_MULTIPLIER = 3.0;

    /**
     * Last-seen state per sessionId|msgName stream. Single writer per session
     * (the analysis lane); the sweeper only reads and latches {@code timedOut}.
     */
    private final ConcurrentHashMap<String, MsgState> msgStates = new ConcurrentHashMap<>();

    /**
     * Dedup index: sessionId|msgName|faultType|detail -> persisted fault row id.
     * A repeat occurrence increments the row instead of inserting a new one.
     */
    private final ConcurrentHashMap<String, Long> faultIdByDedupKey = new ConcurrentHashMap<>();

    // Per-session rolling snapshot of the latest value seen for every signal, keyed by
    // sessionId -> (signalName -> latest reading). Lets each raised fault capture the
    // vehicle's operating context (gear/speed/engine/key/doors) at the moment of detection.
    // Context signal names live in {@link VehicleStateSignals} (shared with back-fill).
    private final ConcurrentHashMap<String, Map<String, SignalData>> latestSignals = new ConcurrentHashMap<>();

    // sessionId -> catalog filenames the session is scoped to (empty set = all
    // catalogs). Resolved once per session from the session's linked car so two
    // catalog variants sharing message IDs/names can never cross-contaminate
    // integrity checks. Evicted in clearSession().
    private final ConcurrentHashMap<String, Set<String>> sessionCatalogScope = new ConcurrentHashMap<>();

    /** Mutable last-seen state for one sessionId|msgName stream. */
    private static final class MsgState {
        volatile double timestamp;          // frame-domain timestamp of last frame
        volatile double absoluteTs;         // same instant, absolute Unix seconds
        volatile String rawBytes = "";
        volatile Integer seq;
        volatile String msgId;
        volatile long arrivalNanos;         // wall-clock arrival, for the sweeper
        final AtomicBoolean timedOut = new AtomicBoolean(false);
    }

    /** A fault plus the dedup identity it collapses on. */
    private record PendingFault(String dedupKey, IntegrityFaultEntity fault) {}

    /** Run all integrity checks on a frame and persist any faults. */
    public void analyze(CanFrameEntity frame, String signalsJson, double sessionStartTs) {
        List<PendingFault> faults = new ArrayList<>();
        String stateKey = frame.getSessionId() + "|" + frame.getMsgName();

        // Parse this frame's signals once and roll the session's latest-value map forward
        // so any fault raised below can snapshot the current vehicle-state context.
        List<SignalData> signals = parseSignals(signalsJson, frame);
        updateLatestSignals(frame.getSessionId(), signals);

        Set<String> catalogScope = resolveCatalogScope(frame.getSessionId());

        // Normalize to absolute Unix seconds using the exact same formula as
        // InfluxWriteService.writeFrame() — fault timestamps must land in the same
        // domain as CanFrameResponse.timestamp or frontend fault/frame correlation
        // (msgId + timestamp) can never match for sessions with relative timestamps.
        double frameTs = frame.getTimestamp() != null ? frame.getTimestamp() : 0.0;
        double absoluteTs = frameTs > 1_000_000_000.0 ? frameTs : sessionStartTs + frameTs;

        MsgState state = msgStates.get(stateKey);

        if (state != null && frame.getRawBytes() != null) {
            double gap = frameTs - state.timestamp;

            // Check 1 — Duplicate detection
            if (gap < MIN_INTERVAL_SECONDS && state.rawBytes.equals(frame.getRawBytes())) {
                faults.add(new PendingFault(dedupKey(stateKey, "DUPLICATE", null),
                        buildFault(frame, absoluteTs, "DUPLICATE",
                                String.format(Locale.ROOT, "Duplicate frame for %s within %.4fs",
                                        frame.getMsgId(), gap), signals)));
            }

            // Check 2 — Timing gap (only for cyclic messages, session-scoped catalog view)
            Long cycleMs = catalogLoaderService.getCycleTime(frame.getMsgName(), catalogScope);
            if (cycleMs != null) {
                double maxGapSeconds = (cycleMs * GAP_MULTIPLIER) / 1000.0;
                if (gap > maxGapSeconds) {
                    faults.add(new PendingFault(dedupKey(stateKey, "TIMING_GAP", null),
                            buildFault(frame, absoluteTs, "TIMING_GAP",
                                    String.format(Locale.ROOT, "Gap of %.2fs for %s exceeds %.1fs (cycle=%dms × %.0f)",
                                            gap, frame.getMsgName(), maxGapSeconds, cycleMs,
                                            GAP_MULTIPLIER), signals)));
                }
            }
        }

        // Check 3 — Signal range validation using catalog valid values.
        // Valid sets are scoped to this frame's message so a same-named signal
        // on another bus can never leak its enum into this check.
        if (!signals.isEmpty()) {
            Map<String, Set<Integer>> validValues =
                    catalogLoaderService.getValidValues(frame.getMsgName(), catalogScope);
            for (SignalData signal : signals) {
                String name = signal.signalName();
                Object rawVal = signal.rawValue();
                if (name == null || !(rawVal instanceof Number number)) {
                    continue;
                }

                Set<Integer> allowed = validValues.get(name);
                if (allowed == null || allowed.isEmpty()) {
                    continue;
                }

                int value = number.intValue();
                if (!allowed.contains(value)) {
                    faults.add(new PendingFault(dedupKey(stateKey, "SIGNAL_RANGE", name),
                            buildFault(frame, absoluteTs, "SIGNAL_RANGE",
                                    String.format("Signal %s value %d not in valid set %s",
                                            name, value, allowed), signals)));
                }
            }
        }

        // Check 4 — Counter/sequence (frame_seq assigned by the producer per msg_id).
        // A forward jump is a gap (lost frames); going backwards or repeating is a
        // regression — the classic replay/counter-reset signature.
        Integer seq = frame.getFrameSeq();
        Integer nextSeq = state != null ? state.seq : null;
        if (seq != null && seq >= 0) {
            Integer prevSeq = state != null ? state.seq : null;
            if (prevSeq != null && seq > prevSeq + 1) {
                faults.add(new PendingFault(dedupKey(stateKey, "COUNTER_ERROR", null),
                        buildFault(frame, absoluteTs, "COUNTER_ERROR",
                                String.format("Sequence gap for %s: expected %d, got %d (skipped %d)",
                                        frame.getMsgName(), prevSeq + 1, seq, seq - prevSeq - 1),
                                signals)));
            } else if (prevSeq != null && seq <= prevSeq) {
                faults.add(new PendingFault(dedupKey(stateKey, "SEQUENCE_REGRESSION", null),
                        buildFault(frame, absoluteTs, "SEQUENCE_REGRESSION",
                                String.format("Sequence regression for %s: got %d after %d "
                                                + "(replay or counter reset)",
                                        frame.getMsgName(), seq, prevSeq), signals)));
            }
            nextSeq = prevSeq == null ? seq : Math.max(prevSeq, seq);
        }

        // Roll the per-message state forward (single writer per session lane).
        if (state == null) {
            state = new MsgState();
            msgStates.put(stateKey, state);
        }
        state.timestamp = frameTs;
        state.absoluteTs = absoluteTs;
        state.rawBytes = frame.getRawBytes() != null ? frame.getRawBytes() : "";
        state.seq = nextSeq;
        state.msgId = frame.getMsgId();
        state.arrivalNanos = System.nanoTime();
        state.timedOut.set(false); // message resumed — re-arm the sweeper latch

        persistFaults(frame.getSessionId(), faults);
    }

    /**
     * Dead-message detection: a cyclic message whose stream goes silent never
     * produces another frame, so frame-driven checks can't see it. This sweep
     * compares wall-clock silence per stream against the catalog cycle time and
     * raises a latched MESSAGE_TIMEOUT (one fault per silence episode; the latch
     * re-arms when the message resumes). Also fires at the natural end of a
     * replayed log until the session completes — that reads as "stream ended".
     */
    @Scheduled(fixedDelay = 500)
    public void sweepSilentCyclicMessages() {
        long now = System.nanoTime();
        for (Map.Entry<String, MsgState> entry : msgStates.entrySet()) {
            MsgState state = entry.getValue();
            if (state.timedOut.get()) {
                continue;
            }
            String key = entry.getKey();
            int sep = key.indexOf('|');
            if (sep <= 0) {
                continue;
            }
            String sessionId = key.substring(0, sep);
            String msgName = key.substring(sep + 1);
            // Cached scope only — never hit the DB from the sweeper loop.
            Set<String> scope = sessionCatalogScope.getOrDefault(sessionId, Set.of());
            Long cycleMs = catalogLoaderService.getCycleTime(msgName, scope);
            if (cycleMs == null) {
                continue;
            }
            double maxGapSeconds = (cycleMs * GAP_MULTIPLIER) / 1000.0;
            double silentSeconds = (now - state.arrivalNanos) / 1_000_000_000.0;
            if (silentSeconds > maxGapSeconds && state.timedOut.compareAndSet(false, true)) {
                IntegrityFaultEntity fault = IntegrityFaultEntity.builder()
                        .sessionId(sessionId)
                        .msgId(state.msgId)
                        .msgName(msgName)
                        .faultType("MESSAGE_TIMEOUT")
                        .description(String.format(Locale.ROOT,
                                "%s silent for %.1fs — expected every %dms (limit %.1fs). "
                                        + "ECU stopped transmitting or stream ended.",
                                msgName, silentSeconds, cycleMs, maxGapSeconds))
                        .frameTimestamp(state.absoluteTs)
                        .lastSeenTs(state.absoluteTs)
                        .build();
                persistFaults(sessionId,
                        List.of(new PendingFault(dedupKey(key, "MESSAGE_TIMEOUT", null), fault)));
                log.warn("MESSAGE_TIMEOUT: {} in session {} silent for {}s",
                        msgName, sessionId, String.format(Locale.ROOT, "%.1f", silentSeconds));
            }
        }
    }

    /**
     * Remove all per-session state entries for the given session.
     * Called by CanSessionService both when a session completes naturally
     * (status=COMPLETE) and when a session is explicitly deleted, to prevent
     * unbounded memory growth in the per-message state and dedup maps.
     *
     * @param sessionId the session that completed or is being deleted
     */
    public void clearSession(String sessionId) {
        String prefix = sessionId + "|";
        msgStates.keySet().removeIf(key -> key.startsWith(prefix));
        faultIdByDedupKey.keySet().removeIf(key -> key.startsWith(prefix));
        latestSignals.remove(sessionId);
        sessionCatalogScope.remove(sessionId);
        log.info("Cleared integrity analyzer state for session: {}", sessionId);
    }

    /**
     * Catalog filenames this session's checks must be restricted to.
     * Empty set = all catalogs. The session row may not exist yet when the first
     * frames arrive (session-meta races the frame stream) — in that case fall
     * back to the global scope WITHOUT caching so a later frame retries.
     */
    private Set<String> resolveCatalogScope(String sessionId) {
        if (sessionId == null) {
            return Set.of();
        }
        Set<String> cached = sessionCatalogScope.get(sessionId);
        if (cached != null) {
            return cached;
        }
        try {
            CanSessionEntity session = canSessionRepository.findBySessionId(sessionId).orElse(null);
            if (session == null) {
                return Set.of();
            }
            Set<String> scope = session.getCarId() == null
                    ? Set.of()
                    : Set.copyOf(carRepository.findCatalogFilenamesByCarId(session.getCarId()));
            sessionCatalogScope.put(sessionId, scope);
            if (!scope.isEmpty()) {
                log.info("Session {} integrity checks scoped to catalogs {}", sessionId, scope);
            }
            return scope;
        } catch (Exception e) {
            log.warn("Could not resolve catalog scope for session {}: {}", sessionId, e.getMessage());
            return Set.of();
        }
    }

    /** Identity a repeat of the same fault collapses on. */
    private String dedupKey(String stateKey, String faultType, String detail) {
        return stateKey + "|" + faultType + "|" + (detail != null ? detail : "");
    }

    /**
     * Insert new faults; collapse repeats into an occurrence-count increment on
     * the already-persisted row (flood control — see V6 migration).
     */
    private void persistFaults(String sessionId, List<PendingFault> pending) {
        if (pending.isEmpty()) {
            return;
        }
        int inserted = 0;
        int repeated = 0;
        for (PendingFault p : pending) {
            try {
                Long existingId = faultIdByDedupKey.get(p.dedupKey());
                if (existingId != null) {
                    faultRepository.incrementOccurrences(existingId, p.fault().getFrameTimestamp());
                    repeated++;
                } else {
                    IntegrityFaultEntity saved = faultRepository.save(p.fault());
                    faultIdByDedupKey.put(p.dedupKey(), saved.getId());
                    findingCorrelationService.onFindingPersisted(saved, List.of());
                    inserted++;
                }
            } catch (Exception e) {
                log.error("Failed to persist fault {} for session {}: {}",
                        p.fault().getFaultType(), sessionId, e.getMessage());
            }
        }
        if (inserted > 0) {
            log.info("Saved {} new fault(s) ({} repeat(s)) for session {}",
                    inserted, repeated, sessionId);
        }
    }

    private IntegrityFaultEntity buildFault(CanFrameEntity frame, double absoluteTs, String type,
                                            String desc, List<SignalData> frameSignals) {
        return IntegrityFaultEntity.builder()
                .sessionId(frame.getSessionId())
                .msgId(frame.getMsgId())
                .msgName(frame.getMsgName())
                .faultType(type)
                .description(desc)
                .frameTimestamp(absoluteTs)
                .lastSeenTs(absoluteTs)
                .contextJson(buildContextJson(frame, frameSignals))
                .build();
    }

    /** Parse a frame's {@code signals} JSON payload; empty (never null) on absence or error. */
    private List<SignalData> parseSignals(String signalsJson, CanFrameEntity frame) {
        if (signalsJson == null || signalsJson.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(signalsJson, new TypeReference<List<SignalData>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse signals for frame {}: {}", frame.getId(), e.getMessage());
            return List.of();
        }
    }

    /** Roll the session's latest-value map forward with this frame's readings. */
    private void updateLatestSignals(String sessionId, List<SignalData> signals) {
        if (signals.isEmpty()) {
            return;
        }
        Map<String, SignalData> sessionMap =
                latestSignals.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>());
        for (SignalData s : signals) {
            if (s.signalName() != null && s.rawValue() != null) {
                sessionMap.put(s.signalName(), s);
            }
        }
    }

    /**
     * Snapshot the operating context for a fault: the affected message's own signals first,
     * then the vehicle-state context (gear/speed/engine/key/doors, plus ADAS extras for ADAS
     * faults) from the session's rolling latest-value map. Returns a JSON array string, or
     * {@code null} when nothing is known yet.
     */
    private String buildContextJson(CanFrameEntity frame, List<SignalData> frameSignals) {
        // LinkedHashMap keeps insertion order and de-dupes by signal name.
        Map<String, FaultContextSignal> ctx = new LinkedHashMap<>();
        for (SignalData s : frameSignals) {
            if (s.signalName() != null && s.rawValue() != null) {
                ctx.putIfAbsent(s.signalName(), new FaultContextSignal(s.signalName(), s.rawValue(), s.label()));
            }
        }

        Map<String, SignalData> sessionMap = latestSignals.get(frame.getSessionId());
        if (sessionMap != null) {
            boolean adas = VehicleStateSignals.ADAS_BUS.equalsIgnoreCase(
                    catalogLoaderService.getMessageSubsystems().get(frame.getMsgName()));
            Set<String> wanted = new LinkedHashSet<>(VehicleStateSignals.BASE);
            if (adas) {
                wanted.addAll(VehicleStateSignals.ADAS);
            }
            for (String name : wanted) {
                SignalData s = sessionMap.get(name);
                if (s != null && s.rawValue() != null) {
                    ctx.putIfAbsent(name, new FaultContextSignal(name, s.rawValue(), s.label()));
                }
            }
        }

        if (ctx.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(new ArrayList<>(ctx.values()));
        } catch (Exception e) {
            log.warn("Failed to serialize fault context for session {}: {}",
                    frame.getSessionId(), e.getMessage());
            return null;
        }
    }
}
