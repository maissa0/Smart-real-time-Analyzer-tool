package com.example.backend.can.kafka;

import com.example.backend.can.config.KafkaTopicConfig;
import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.service.FindingCorrelationService;
import com.example.backend.can.service.InfluxWriteService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Maps anomaly-events from the Phase-4 Python anomaly engine onto the shared
 * findings store: layer=ML, faultType=ML_&lt;type&gt;, severity capped at LOW
 * (plan §4.5 — ML findings never exceed LOW unless correlated in Phase 5).
 * One store, one API: ML findings surface through the same faults endpoint
 * and UI as SPEC and REQUIREMENT findings.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AnomalyEventConsumer {

    private static final String LAYER_ML = "ML";
    private static final Set<String> ALLOWED_SEVERITIES = Set.of("INFO", "LOW");

    private final IntegrityFaultRepository faultRepository;
    private final InfluxWriteService influxWriteService;
    private final FindingCorrelationService findingCorrelationService;
    private final ObjectMapper objectMapper;

    /** sessionId|msgName|type|signal -> persisted finding row id (occurrence dedup). */
    private final ConcurrentHashMap<String, Long> findingIdByDedupKey = new ConcurrentHashMap<>();

    @KafkaListener(topics = KafkaTopicConfig.TOPIC_ANOMALY_EVENTS,
            groupId = "${spring.kafka.consumer.group-id}")
    public void consumeAnomalyEvent(String message, Acknowledgment ack) {
        try {
            persist(objectMapper.readTree(message));
        } catch (Exception e) {
            // ML findings are advisory — a malformed event must never wedge
            // the consumer group, so always acknowledge (dead-letter policy).
            log.error("Failed to process anomaly-events message: {}", e.getMessage());
        }
        ack.acknowledge();
    }

    /** Drop the session's dedup entries (same lifecycle as the other analyzers). */
    public void clearSession(String sessionId) {
        String prefix = sessionId + "|";
        findingIdByDedupKey.keySet().removeIf(key -> key.startsWith(prefix));
    }

    private void persist(JsonNode event) {
        String sessionId = event.path("session_id").asText("");
        if (sessionId.isBlank()) {
            return;
        }
        String type = event.path("type").asText("OUTLIER");
        String msgName = event.path("msg_name").asText("");
        String signal = event.path("evidence").path("signal").asText("");
        String dedupKey = sessionId + "|" + msgName + "|" + type + "|" + signal;

        // Same absolute-seconds normalization as the other analyzers, so ML
        // findings line up with frames and other findings on the timeline.
        double frameTs = event.path("timestamp").asDouble(0);
        double absoluteTs = frameTs > 1_000_000_000.0
                ? frameTs
                : influxWriteService.getSessionStartTs(sessionId) + frameTs;

        Long existingId = findingIdByDedupKey.get(dedupKey);
        if (existingId != null) {
            faultRepository.incrementOccurrences(existingId, absoluteTs);
            return;
        }

        String severity = event.path("severity").asText("INFO").toUpperCase(Locale.ROOT);
        if (!ALLOWED_SEVERITIES.contains(severity)) {
            severity = "LOW";
        }

        IntegrityFaultEntity saved = faultRepository.save(IntegrityFaultEntity.builder()
                .sessionId(sessionId)
                .msgId(event.path("msg_id").asText(null))
                .msgName(msgName)
                .faultType("ML_" + type)
                .description(event.path("title").asText("Unspecified anomaly"))
                .frameTimestamp(absoluteTs)
                .lastSeenTs(absoluteTs)
                .layer(LAYER_ML)
                .severity(severity)
                .evidenceJson(event.path("evidence").isMissingNode()
                        ? null : event.path("evidence").toString())
                .build());
        findingIdByDedupKey.put(dedupKey, saved.getId());
        // Phase-5 fusion: may boost this finding above LOW when it overlaps a
        // REQUIREMENT finding window, and assigns its root-cause cluster.
        findingCorrelationService.onFindingPersisted(saved, List.of());
        log.info("ML finding {} persisted for session {} ({})", type, sessionId, msgName);
    }
}
