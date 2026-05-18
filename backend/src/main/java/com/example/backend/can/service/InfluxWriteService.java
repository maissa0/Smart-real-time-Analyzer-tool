package com.example.backend.can.service;

import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.repository.CanSessionRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.influxdb.client.WriteApiBlocking;
import com.influxdb.client.domain.WritePrecision;
import com.influxdb.client.write.Point;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class InfluxWriteService {

    private final WriteApiBlocking writeApi;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final CanSessionRepository canSessionRepository;

    /**
     * Cache of sessionId → startTs to avoid hitting MySQL on every frame write.
     * Populated lazily on first frame write for a session.
     */
    private final ConcurrentHashMap<String, Double> sessionStartTsCache = new ConcurrentHashMap<>();

    @Value("${influxdb.url}")
    private String influxUrl;

    @Value("${influxdb.token}")
    private String influxToken;

    @Value("${influxdb.bucket}")
    private String bucket;

    @Value("${influxdb.org}")
    private String influxOrg;

    /**
     * Validate sessionId format before using it in any InfluxDB query or predicate.
     * Accepts only alphanumeric characters, hyphens, and underscores (UUID format).
     */
    private void validateSessionId(String sessionId) {
        if (sessionId == null || !sessionId.matches("[a-zA-Z0-9_-]{1,64}")) {
            log.warn("Invalid sessionId rejected: '{}'", sessionId);
            throw new IllegalArgumentException(
                    "Invalid sessionId format — only alphanumeric, hyphen and underscore allowed"
            );
        }
    }

    /**
     * Get the session startTs for a given sessionId.
     * Uses an in-memory cache to avoid a MySQL query per frame.
     * Falls back to 0.0 if session not found (should not happen in normal flow).
     */
    private double getSessionStartTs(String sessionId) {
        return sessionStartTsCache.computeIfAbsent(sessionId, id -> {
            return canSessionRepository.findBySessionId(id)
                    .map(CanSessionEntity::getStartTs)
                    .map(ts -> ts != null ? ts : 0.0)
                    .orElse(0.0);
        });
    }

    /**
     * Writes each decoded signal from the frame as a point in InfluxDB.
     *
     * Timestamp strategy:
     * - frame.getTimestamp() may be relative (0.010s for uploaded files)
     *   or absolute (1778000000.010s for live simulation).
     * - We always store as absolute Unix time by adding session.startTs
     *   to the frame's relative timestamp.
     * - For live sessions: startTs ≈ time.time() at session creation,
     *   frame.timestamp ≈ time.time() per frame → absolute already.
     *   Adding startTs would double-count. So we detect this case:
     *   if frame.timestamp > startTs × 0.5 it is already absolute.
     * - For uploaded files: startTs = upload time (real Unix),
     *   frame.timestamp = relative (0.0 to N seconds).
     *   We add startTs to get absolute time.
     */
    public void writeFrame(CanFrameEntity frame) {
        try {
            List<Map<String, Object>> signals = objectMapper.readValue(
                frame.getSignals(),
                new TypeReference<>() {}
            );
            if (signals == null || signals.isEmpty()) {
                return;
            }

            double sessionStartTs = getSessionStartTs(frame.getSessionId());
            double frameTs = frame.getTimestamp();

            double absoluteTs;
            if (frameTs > 1_000_000_000.0) {
                absoluteTs = frameTs;
            } else {
                absoluteTs = sessionStartTs + frameTs;
            }
            long nanos = (long)(absoluteTs * 1_000_000_000L);

            // Build ALL points first then write in ONE batch call
            // This is 5x faster than writing one point per signal
            List<Point> points = new java.util.ArrayList<>();
            for (Map<String, Object> signal : signals) {
                String signalName = (String) signal.get("signal_name");
                Object rawValue   = signal.get("raw_value");
                String label      = (String) signal.get("label");

                if (signalName == null || rawValue == null) continue;

                double value;
                if (rawValue instanceof Number) {
                    value = ((Number) rawValue).doubleValue();
                } else {
                    continue;
                }

                points.add(Point
                    .measurement("can_signals")
                    .addTag("session_id",   frame.getSessionId())
                    .addTag("msg_id",       frame.getMsgId())
                    .addTag("msg_name",     frame.getMsgName())
                    .addTag("signal_name",  signalName)
                    .addTag("channel_name", frame.getChannelName())
                    .addTag("label",        label != null ? label : "")
                    .addField("value", value)
                    .time(nanos, WritePrecision.NS));
            }

            if (!points.isEmpty()) {
                // ONE network call for all signals in this frame
                writeApi.writePoints(bucket, influxOrg, points);
                log.debug("Batch wrote {} signals for frame {} session {}",
                        points.size(), frame.getId(), frame.getSessionId());
            }

        } catch (Exception e) {
            log.error("Failed to write frame to InfluxDB: frameId={} error={}",
                    frame.getId(), e.getMessage(), e);
        }
    }

    /**
     * Clear the session start timestamp cache entry when a session is deleted.
     */
    public void evictSessionCache(String sessionId) {
        sessionStartTsCache.remove(sessionId);
    }

    public void deleteSession(String sessionId) {
        validateSessionId(sessionId);
        evictSessionCache(sessionId);
        try {
            String url = influxUrl + "/api/v2/delete?org=" + influxOrg + "&bucket=" + bucket;
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Token " + influxToken);
            headers.setContentType(MediaType.APPLICATION_JSON);
            String body = String.format("""
                {
                    "start": "2000-01-01T00:00:00Z",
                    "stop": "%s",
                    "predicate": "_measurement=\\"can_signals\\" AND session_id=\\"%s\\""
                }
                """,
                java.time.Instant.now().plusSeconds(3600).toString(),
                sessionId
            );
            HttpEntity<String> request = new HttpEntity<>(body, headers);
            restTemplate.postForEntity(url, request, String.class);
            log.info("Deleted InfluxDB data for session: {}", sessionId);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to delete InfluxDB data for session: {}", sessionId, e);
            throw new RuntimeException("InfluxDB delete failed for session: " + sessionId, e);
        }
    }
}
