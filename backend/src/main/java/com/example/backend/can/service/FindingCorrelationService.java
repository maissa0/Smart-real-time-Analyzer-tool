package com.example.backend.can.service;

import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Phase-5 fusion layer (docs/ANOMALY_REDESIGN_PLAN.md §5). Runs synchronously
 * after each NEW finding insert (repeat occurrences never re-enter) and does
 * two things:
 *
 * 1. Root-cause clustering — findings that share an ECU/subsystem within
 *    {@link #CLUSTER_WINDOW_SEC} of each other get one session-scoped
 *    clusterId ("Body &amp; Comfort#1"), so the UI can say
 *    "Body &amp; Comfort: 3 findings in 2s" instead of three separate cards.
 *
 * 2. ML ↔ REQUIREMENT merge — an advisory ML finding whose timestamp falls
 *    inside a requirement finding's evidence window (trigger → violation,
 *    padded by {@link #MERGE_WINDOW_SEC}) is attached to that finding as
 *    supporting evidence, adopts its cluster, and has its severity boosted to
 *    {@link #BOOSTED_ML_SEVERITY} — the only path an ML finding may exceed
 *    LOW (plan §4.5). Both arrival orders are handled.
 *
 * Threading: producers call in from the per-session analysis lane, the
 * deadline sweeper, and the anomaly-events Kafka listener. All mutation is
 * synchronized on the per-session state; DB writes use targeted UPDATE
 * queries so they cannot race the occurrence counter.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FindingCorrelationService {

    static final String LAYER_REQUIREMENT = "REQUIREMENT";
    static final String LAYER_ML = "ML";
    static final String BOOSTED_ML_SEVERITY = "MEDIUM";

    /** Findings of one subsystem within this many seconds share a cluster. */
    static final double CLUSTER_WINDOW_SEC = 2.0;
    /** Padding around a requirement finding's evidence window for ML merges. */
    static final double MERGE_WINDOW_SEC = 2.0;
    /** Tracked findings older than this (frame time) are forgotten. */
    private static final double EVICT_WINDOW_SEC = 60.0;
    private static final int MAX_TRACKED_PER_SESSION = 500;

    private final IntegrityFaultRepository faultRepository;
    private final DiagnosticKbService diagnosticKbService;
    private final ObjectMapper objectMapper;

    /** One already-persisted finding kept for correlation lookback. */
    private record Tracked(long id, String layer, double ts, double windowStart,
                           double windowEnd, String requirementId, String clusterId,
                           String faultType, String description) {}

    private static final class OpenCluster {
        String clusterId;
        double lastTs;
    }

    private static final class SessionState {
        final List<Tracked> recent = new ArrayList<>();
        final Map<String, OpenCluster> openBySubsystem = new HashMap<>();
        int clusterSeq;
    }

    private final ConcurrentHashMap<String, SessionState> sessions = new ConcurrentHashMap<>();

    /**
     * Correlate one just-inserted finding. {@code candidateSignals} is the
     * subsystem hint for REQUIREMENT findings (catalog signal names referenced
     * by the violated rule); SPEC/ML findings resolve via their message name.
     * Best-effort: a failure here must never break finding persistence.
     */
    public void onFindingPersisted(IntegrityFaultEntity finding, List<String> candidateSignals) {
        try {
            correlate(finding, candidateSignals != null ? candidateSignals : List.of());
        } catch (Exception e) {
            log.error("Correlation failed for finding {} in session {}: {}",
                    finding.getId(), finding.getSessionId(), e.getMessage());
        }
    }

    /** Drop the session's correlation state (same lifecycle as the analyzers). */
    public void clearSession(String sessionId) {
        sessions.remove(sessionId);
    }

    private void correlate(IntegrityFaultEntity finding, List<String> candidateSignals) {
        String sessionId = finding.getSessionId();
        Double ts = finding.getFrameTimestamp();
        if (sessionId == null || finding.getId() == null || ts == null) {
            return;
        }
        SessionState st = sessions.computeIfAbsent(sessionId, k -> new SessionState());
        synchronized (st) {
            String subsystem = resolveSubsystem(finding, candidateSignals);
            double windowStart = ts - MERGE_WINDOW_SEC;
            double windowEnd = ts + MERGE_WINDOW_SEC;
            if (LAYER_REQUIREMENT.equals(finding.getLayer())) {
                Double triggerTs = triggerTsFromEvidence(finding.getEvidenceJson());
                if (triggerTs != null && triggerTs < ts) {
                    windowStart = triggerTs - MERGE_WINDOW_SEC;
                }
            }

            String clusterId = assignCluster(st, subsystem, ts);
            faultRepository.updateClusterId(finding.getId(), clusterId);
            finding.setClusterId(clusterId);

            if (LAYER_ML.equals(finding.getLayer())) {
                clusterId = mergeMlIntoRequirement(finding, st, ts, clusterId);
            } else if (LAYER_REQUIREMENT.equals(finding.getLayer())) {
                mergeRecentMlIntoThis(finding, st, windowStart, windowEnd, clusterId);
            }

            st.recent.add(new Tracked(finding.getId(), finding.getLayer(), ts,
                    windowStart, windowEnd, finding.getRequirementId(), clusterId,
                    finding.getFaultType(), finding.getDescription()));
            evict(st, ts);
        }
    }

    // ── Clustering ───────────────────────────────────────────────────────────

    /**
     * Join the subsystem's open cluster when this finding is within the window
     * of its most recent member; otherwise open a new one. Single-finding
     * clusters are normal — the UI only surfaces clusters with 2+ findings.
     */
    private String assignCluster(SessionState st, String subsystem, double ts) {
        OpenCluster cluster = st.openBySubsystem.get(subsystem);
        if (cluster == null || Math.abs(ts - cluster.lastTs) > CLUSTER_WINDOW_SEC) {
            cluster = new OpenCluster();
            cluster.clusterId = subsystem + "#" + (++st.clusterSeq);
            st.openBySubsystem.put(subsystem, cluster);
        }
        cluster.lastTs = Math.max(cluster.lastTs, ts);
        return cluster.clusterId;
    }

    // ── ML ↔ REQUIREMENT merge ───────────────────────────────────────────────

    /** ML finding arrives after the requirement finding it supports. */
    private String mergeMlIntoRequirement(IntegrityFaultEntity ml, SessionState st,
                                          double ts, String ownClusterId) {
        for (Tracked req : st.recent) {
            if (!LAYER_REQUIREMENT.equals(req.layer())
                    || ts < req.windowStart() || ts > req.windowEnd()) {
                continue;
            }
            applyMlSideOfMerge(ml.getId(), ml.getSeverity(), req.id(),
                    req.requirementId(), req.clusterId());
            appendSupportingMl(req.id(), ml.getId(), ml.getFaultType(),
                    ml.getDescription(), ts);
            ml.setSeverity(BOOSTED_ML_SEVERITY);
            ml.setClusterId(req.clusterId());
            log.info("ML finding {} correlated with requirement finding {} ({})",
                    ml.getId(), req.id(), req.requirementId());
            return req.clusterId();
        }
        return ownClusterId;
    }

    /** Requirement finding arrives after ML findings inside its window. */
    private void mergeRecentMlIntoThis(IntegrityFaultEntity req, SessionState st,
                                       double windowStart, double windowEnd, String clusterId) {
        List<Tracked> supporting = new ArrayList<>();
        for (Tracked ml : st.recent) {
            if (LAYER_ML.equals(ml.layer())
                    && ml.ts() >= windowStart && ml.ts() <= windowEnd) {
                supporting.add(ml);
            }
        }
        if (supporting.isEmpty()) {
            return;
        }
        for (Tracked ml : supporting) {
            applyMlSideOfMerge(ml.id(), null, req.getId(),
                    req.getRequirementId(), clusterId);
        }
        for (Tracked ml : supporting) {
            appendSupportingMl(req.getId(), ml.id(), ml.faultType(), ml.description(), ml.ts());
        }
        log.info("Requirement finding {} ({}) gained {} supporting ML finding(s)",
                req.getId(), req.getRequirementId(), supporting.size());
    }

    /** Boost + link the ML row via one targeted update. */
    private void applyMlSideOfMerge(Long mlId, String previousSeverity, Long reqFindingId,
                                    String requirementId, String clusterId) {
        ObjectNode link = objectMapper.createObjectNode();
        link.put("supportsFindingId", reqFindingId);
        if (requirementId != null) {
            link.put("requirementId", requirementId);
        }
        link.put("boostedFrom", previousSeverity != null ? previousSeverity : "LOW");
        faultRepository.applyMlCorrelation(mlId, clusterId, BOOSTED_ML_SEVERITY, link.toString());
    }

    /** Append one supporting-ML entry to the requirement finding's links. */
    private void appendSupportingMl(Long reqFindingId, long mlId, String faultType,
                                    String description, double ts) {
        IntegrityFaultEntity req = faultRepository.findById(reqFindingId).orElse(null);
        if (req == null) {
            return;
        }
        ObjectNode root = parseObject(req.getCorrelationJson());
        ArrayNode arr = root.withArray("supportingMl");
        for (JsonNode existing : arr) {
            if (existing.path("findingId").asLong() == mlId) {
                return; // already linked
            }
        }
        ObjectNode entry = arr.addObject();
        entry.put("findingId", mlId);
        entry.put("faultType", faultType);
        entry.put("description", description);
        entry.put("ts", ts);
        faultRepository.updateCorrelationJson(reqFindingId, root.toString());
    }

    private ObjectNode parseObject(String json) {
        if (json != null && !json.isBlank()) {
            try {
                JsonNode node = objectMapper.readTree(json);
                if (node instanceof ObjectNode obj) {
                    return obj;
                }
            } catch (Exception e) {
                log.warn("Unparseable correlation JSON, starting fresh: {}", e.getMessage());
            }
        }
        return objectMapper.createObjectNode();
    }

    // ── Subsystem resolution ─────────────────────────────────────────────────

    /**
     * SPEC/ML findings name a real CAN message — resolve through the KB
     * mapping. REQUIREMENT findings carry the rule id in msgName, so resolve
     * from the first rule signal that a loaded catalog owns.
     */
    private String resolveSubsystem(IntegrityFaultEntity finding, List<String> candidateSignals) {
        if (!LAYER_REQUIREMENT.equals(finding.getLayer())) {
            return diagnosticKbService.subsystemFor(finding.getMsgName());
        }
        return diagnosticKbService.subsystemForSignals(candidateSignals);
    }

    // ── Evidence + housekeeping ──────────────────────────────────────────────

    /** Trigger timestamp from a requirement finding's evidence, when present. */
    private Double triggerTsFromEvidence(String evidenceJson) {
        if (evidenceJson == null || evidenceJson.isBlank()) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(evidenceJson);
            String key = node.has("triggerTs") ? "triggerTs"
                    : node.has("enteredTs") ? "enteredTs" : null;
            return key != null ? node.path(key).asDouble() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private void evict(SessionState st, double nowTs) {
        Iterator<Tracked> it = st.recent.iterator();
        while (it.hasNext()) {
            if (it.next().ts() < nowTs - EVICT_WINDOW_SEC) {
                it.remove();
            }
        }
        while (st.recent.size() > MAX_TRACKED_PER_SESSION) {
            st.recent.remove(0);
        }
        st.openBySubsystem.values().removeIf(c ->
                nowTs - c.lastTs > EVICT_WINDOW_SEC);
    }

    /** Human label for a cluster id ("Body &amp; Comfort#1" → "Body &amp; Comfort"). */
    public static String subsystemOf(String clusterId) {
        if (clusterId == null) {
            return null;
        }
        int idx = clusterId.lastIndexOf('#');
        return idx > 0 ? clusterId.substring(0, idx) : clusterId;
    }
}
