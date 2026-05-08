package com.example.backend.can.service;

import com.example.backend.can.entity.CanFrameEntity;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.influxdb.client.WriteApi;
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

import jakarta.annotation.PreDestroy;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class InfluxWriteService {

    private final WriteApi writeApi;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

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
     * Rejects anything that could be used to inject into a Flux predicate string.
     *
     * @param sessionId the session identifier from user input
     * @throws IllegalArgumentException if sessionId contains invalid characters
     */
    private void validateSessionId(String sessionId) {
        if (sessionId == null || !sessionId.matches("[a-zA-Z0-9_-]{1,64}")) {
            log.warn("Invalid sessionId rejected: '{}'", sessionId);
            throw new IllegalArgumentException(
                    "Invalid sessionId format — only alphanumeric, hyphen and underscore allowed"
            );
        }
    }

    /** Writes each decoded signal from the frame as a point in the configured InfluxDB bucket. */
    public void writeFrame(CanFrameEntity frame) {
        try {
            List<Map<String, Object>> signals = objectMapper.readValue(
                frame.getSignals(),
                new TypeReference<>() {}
            );
            for (Map<String, Object> signal : signals) {
                String signalName = (String) signal.get("signal_name");
                Object rawValue = signal.get("raw_value");
                String label = (String) signal.get("label");

                if (signalName == null || rawValue == null) continue;

                double value;
                if (rawValue instanceof Number) {
                    value = ((Number) rawValue).doubleValue();
                } else {
                    continue;
                }

                // Convert Unix timestamp (double seconds) to nanoseconds
                long nanos = (long)(frame.getTimestamp() * 1_000_000_000L);

                Point point = Point
                    .measurement("can_signals")
                    .addTag("session_id", frame.getSessionId())
                    .addTag("msg_id", frame.getMsgId())
                    .addTag("msg_name", frame.getMsgName())
                    .addTag("signal_name", signalName)
                    .addTag("channel_name", frame.getChannelName())
                    .addTag("label", label != null ? label : "")
                    .addField("value", value)
                    .addField("raw_value", value)
                    .time(nanos, WritePrecision.NS);

                writeApi.writePoint(bucket, influxOrg, point);
            }
        } catch (Exception e) {
            log.error("Failed to write frame to InfluxDB: frameId={}", frame.getId(), e);
        }
    }

    public void deleteSession(String sessionId) {
        // Validate before interpolating into the predicate string
        validateSessionId(sessionId);
        try {
            // Use direct HTTP call to InfluxDB /api/v2/delete
            // The Java client DeleteApi does not reliably support tag predicates in InfluxDB 2.7
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

    @PreDestroy
    public void close() {
        try {
            writeApi.flush();
            log.info("InfluxDB WriteApi flushed on shutdown");
            writeApi.close();
            log.info("InfluxDB WriteApi closed on shutdown");
        } catch (Exception e) {
            log.warn("Failed to flush/close InfluxDB WriteApi on shutdown", e);
        }
    }
}
