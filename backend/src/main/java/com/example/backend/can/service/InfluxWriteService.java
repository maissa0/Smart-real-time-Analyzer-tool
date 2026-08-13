package com.example.backend.can.service;

import com.example.backend.can.dto.CanFrameResponse;
import com.example.backend.can.dto.SessionFrameMetadataDto;
import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.dto.SignalData;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.influxdb.client.InfluxDBClient;
import com.influxdb.client.QueryApi;
import com.influxdb.client.WriteApiBlocking;
import com.influxdb.client.domain.WritePrecision;
import com.influxdb.client.write.Point;
import com.influxdb.query.FluxRecord;
import com.influxdb.query.FluxTable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class InfluxWriteService {

    private final InfluxDBClient influxDBClient;
    private final WriteApiBlocking writeApi;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    // Populated by CanSessionService.saveSession() before any frame arrives for a session.
    private final ConcurrentHashMap<String, Double> sessionStartTsCache = new ConcurrentHashMap<>();
    // Tracks the absolute timestamp (Unix seconds) of the last written frame per session.
    private final ConcurrentHashMap<String, Double> sessionLastTsCache  = new ConcurrentHashMap<>();

    @Value("${influxdb.url}")
    private String influxUrl;

    @Value("${influxdb.token}")
    private String influxToken;

    @Value("${influxdb.bucket}")
    private String bucket;

    @Value("${influxdb.org}")
    private String influxOrg;

    // ── Validation ────────────────────────────────────────────────────────────────

    private void validateSessionId(String sessionId) {
        if (sessionId == null || !sessionId.matches("[a-zA-Z0-9_-]{1,64}")) {
            log.warn("Invalid sessionId rejected: '{}'", sessionId);
            throw new IllegalArgumentException(
                    "Invalid sessionId format — only alphanumeric, hyphen and underscore allowed");
        }
    }

    private void validateFluxTag(String value, String paramName) {
        if (value == null || !value.matches("[a-zA-Z0-9_\\-.+: ]{1,128}")) {
            log.warn("Invalid {} rejected: '{}'", paramName, value);
            throw new IllegalArgumentException(
                    "Invalid " + paramName + " format — unsafe characters not allowed");
        }
    }

    // ── Session start-ts cache ────────────────────────────────────────────────────

    public void registerSessionStartTs(String sessionId, Double startTs) {
        if (startTs != null) {
            sessionStartTsCache.put(sessionId, startTs);
        }
    }

    public double getSessionStartTs(String sessionId) {
        return sessionStartTsCache.getOrDefault(sessionId, 0.0);
    }

    public double getSessionLastTs(String sessionId) {
        return sessionLastTsCache.getOrDefault(sessionId, 0.0);
    }

    public void evictSessionCache(String sessionId) {
        sessionStartTsCache.remove(sessionId);
        sessionLastTsCache.remove(sessionId);
    }

    // ── Write ─────────────────────────────────────────────────────────────────────

    /**
     * Writes a raw-frame point to can_frames measurement AND decoded signal points to
     * can_signals measurement, in one batch call.
     *
     * can_frames replaces the MySQL can_frames table — it is written for every frame,
     * even when there are no decodable signals (unknown message IDs).
     *
     * Timestamp strategy: frame.getTimestamp() may be relative (uploaded file) or
     * absolute (live simulator). We always store as absolute Unix nanoseconds using
     * the same logic as the existing can_signals write.
     */
    public void writeFrame(CanFrameEntity frame, String signalsJson, double sessionStartTs) {
        try {
            double frameTs = frame.getTimestamp() != null ? frame.getTimestamp() : 0.0;
            double absoluteTs = frameTs > 1_000_000_000.0 ? frameTs : sessionStartTs + frameTs;
            long nanos = (long) (absoluteTs * 1_000_000_000L);
            sessionLastTsCache.merge(frame.getSessionId(), absoluteTs, Math::max);

            List<Point> points = new ArrayList<>();

            // Parse signals first so we can embed their JSON into the can_frames point.
            // This avoids any server-side join when reading frames back.
            List<SignalData> signals = null;
            String storedSignalsJson = "[]";
            if (signalsJson != null && !signalsJson.isBlank()) {
                signals = objectMapper.readValue(signalsJson, new TypeReference<List<SignalData>>() {});
                if (signals != null) {
                    List<Map<String, Object>> sigList = new ArrayList<>();
                    for (SignalData s : signals) {
                        if (s.signalName() == null || !(s.rawValue() instanceof Number)) continue;
                        Map<String, Object> entry = new LinkedHashMap<>();
                        entry.put("signal_name", s.signalName());
                        entry.put("raw_value", ((Number) s.rawValue()).doubleValue());
                        entry.put("label", s.label() != null ? s.label() : "");
                        sigList.add(entry);
                    }
                    if (!sigList.isEmpty()) {
                        storedSignalsJson = objectMapper.writeValueAsString(sigList);
                    }
                }
            }

            // --- can_frames point (always written, replaces MySQL can_frames table) ---
            points.add(Point
                .measurement("can_frames")
                .addTag("session_id",   frame.getSessionId())
                .addTag("msg_id",       frame.getMsgId() != null ? frame.getMsgId() : "")
                .addTag("msg_name",     frame.getMsgName() != null ? frame.getMsgName() : "")
                .addTag("channel_name", frame.getChannelName() != null ? frame.getChannelName() : "")
                .addField("direction",    frame.getDirection() != null ? frame.getDirection() : "")
                .addField("raw_bytes",    frame.getRawBytes() != null ? frame.getRawBytes() : "")
                .addField("channel",      frame.getChannel() != null ? (long) frame.getChannel() : 0L)
                .addField("signals_json", storedSignalsJson)
                .time(nanos, WritePrecision.NS));

            // --- can_signals points (one per decoded signal, for timeline/analytics queries) ---
            if (signals != null) {
                for (SignalData signal : signals) {
                    String signalName = signal.signalName();
                    Object rawValue   = signal.rawValue();
                    String label      = signal.label();
                    if (signalName == null || rawValue == null) continue;
                    if (!(rawValue instanceof Number)) continue;
                    double value = ((Number) rawValue).doubleValue();
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
            }

            writeApi.writePoints(bucket, influxOrg, points);
            log.debug("Batch wrote 1 frame + {} signals for session {}",
                    points.size() - 1, frame.getSessionId());

        } catch (Exception e) {
            log.error("Failed to write frame to InfluxDB: sessionId={} error={}",
                    frame.getSessionId(), e.getMessage(), e);
        }
    }

    // ── Frame count (replaces canFrameRepository.countBySessionId) ────────────────

    /**
     * Counts frames in the can_frames measurement for a session.
     * Optionally filtered by msgId, channelName, and a set of fault timestamps (nanoseconds).
     * null faultTimestampNanos = no fault filter. Empty list = faults-only but no faults found.
     */
    public long countFrames(String sessionId, String msgId, String channelName,
                            List<Long> faultTimestampNanos) {
        validateSessionId(sessionId);
        if (faultTimestampNanos != null && faultTimestampNanos.isEmpty()) {
            return 0;
        }
        try {
            String flux = buildCountFlux(sessionId, msgId, channelName, faultTimestampNanos);
            QueryApi queryApi = influxDBClient.getQueryApi();
            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            long total = 0;
            for (FluxTable table : tables) {
                for (FluxRecord rec : table.getRecords()) {
                    Object val = rec.getValue();
                    if (val instanceof Number) total += ((Number) val).longValue();
                }
            }
            return total;
        } catch (Exception e) {
            log.warn("Could not count can_frames for session {}: {}", sessionId, e.getMessage());
            return 0;
        }
    }

    // ── Paginated frame query (replaces canFrameRepository.findBySessionIdWithFilters) ──

    /**
     * Returns a page of CanFrameResponse from the can_frames InfluxDB measurement.
     * Replaces all MySQL CanFrameRepository paged queries.
     *
     * @param faultTimestampNanos null = no fault filter; empty list = faults-only but none found
     */
    public Page<CanFrameResponse> queryFramesPaged(
            String sessionId, String msgId, String channelName,
            List<Long> faultTimestampNanos, int page, int size) {
        validateSessionId(sessionId);

        if (faultTimestampNanos != null && faultTimestampNanos.isEmpty()) {
            return new PageImpl<>(List.of(), PageRequest.of(page, size), 0);
        }

        long total = countFrames(sessionId, msgId, channelName, faultTimestampNanos);
        if (total == 0) {
            return new PageImpl<>(List.of(), PageRequest.of(page, size), 0);
        }

        try {
            String flux = buildPagedFlux(sessionId, msgId, channelName,
                    faultTimestampNanos, page, size);
            QueryApi queryApi = influxDBClient.getQueryApi();
            List<FluxTable> tables = queryApi.query(flux, influxOrg);

            List<CanFrameResponse> content = new ArrayList<>();
            for (FluxTable table : tables) {
                for (FluxRecord rec : table.getRecords()) {
                    content.add(recordToResponse(rec, sessionId));
                }
            }
            return new PageImpl<>(content, PageRequest.of(page, size), total);
        } catch (Exception e) {
            log.error("queryFramesPaged failed for session {}: {}", sessionId, e.getMessage(), e);
            return new PageImpl<>(List.of(), PageRequest.of(page, size), total);
        }
    }

    // ── All-frames query (no limit — used for CSV export) ────────────────────────

    /** Returns all frames for a session sorted by time — used by CSV export. No pagination limit. */
    public List<CanFrameResponse> queryAllFrames(String sessionId) {
        validateSessionId(sessionId);
        try {
            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_frames")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
                  |> group()
                  |> sort(columns: ["_time"])
                """, bucket, sessionId);
            QueryApi queryApi = influxDBClient.getQueryApi();
            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            List<CanFrameResponse> result = new ArrayList<>();
            for (FluxTable table : tables) {
                for (FluxRecord rec : table.getRecords()) {
                    result.add(recordToResponse(rec, sessionId));
                }
            }
            return result;
        } catch (Exception e) {
            log.error("queryAllFrames failed for session {}: {}", sessionId, e.getMessage(), e);
            return List.of();
        }
    }

    // ── Distinct tag queries (replace MySQL CanFrameRepository distinct queries) ──

    /** Distinct msg_id values for a session — used by the /metadata endpoint. */
    public List<String> queryDistinctMsgIds(String sessionId) {
        validateSessionId(sessionId);
        return queryDistinctTagValues(sessionId, "msg_id");
    }

    /** Distinct msg_id values scoped to one bus channel. */
    public List<String> queryDistinctMsgIds(String sessionId, String bus) {
        validateSessionId(sessionId);
        if (bus == null || bus.isBlank()) return queryDistinctMsgIds(sessionId);
        validateFluxTag(bus, "bus");
        try {
            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_frames")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["channel_name"] == "%s")
                  |> keep(columns: ["msg_id"])
                  |> distinct(column: "msg_id")
                  |> sort(columns: ["_value"])
                """, bucket, sessionId, bus);
            QueryApi queryApi = influxDBClient.getQueryApi();
            List<String> result = new ArrayList<>();
            for (FluxTable table : queryApi.query(flux, influxOrg))
                for (FluxRecord rec : table.getRecords()) {
                    Object val = rec.getValue();
                    if (val != null && !val.toString().isBlank()) result.add(val.toString());
                }
            return result;
        } catch (Exception e) {
            log.warn("queryDistinctMsgIds(bus) failed session={} bus={}: {}", sessionId, bus, e.getMessage());
            return List.of();
        }
    }

    /** Distinct channel_name values for a session — used by the /metadata endpoint. */
    public List<String> queryDistinctChannelNames(String sessionId) {
        validateSessionId(sessionId);
        return queryDistinctTagValues(sessionId, "channel_name");
    }

    /** Distinct (msg_id, msg_name) pairs for a session — used by the /metadata endpoint. */
    public List<SessionFrameMetadataDto.MessageSummary> queryDistinctMessages(String sessionId) {
        return queryDistinctMessages(sessionId, null);
    }

    /** Distinct (msg_id, msg_name) pairs optionally scoped to a bus channel. */
    public List<SessionFrameMetadataDto.MessageSummary> queryDistinctMessages(String sessionId, String bus) {
        validateSessionId(sessionId);
        if (bus != null && !bus.isBlank()) validateFluxTag(bus, "bus");
        try {
            String busFilter = (bus != null && !bus.isBlank())
                    ? String.format("  |> filter(fn: (r) => r[\"channel_name\"] == \"%s\")\n", bus)
                    : "";
            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_frames")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                %s  |> filter(fn: (r) => r["_field"] == "direction")
                  |> group(columns: ["msg_id", "msg_name"])
                  |> first()
                  |> keep(columns: ["msg_id", "msg_name"])
                  |> group()
                  |> sort(columns: ["msg_id"])
                """, bucket, sessionId, busFilter);
            QueryApi queryApi = influxDBClient.getQueryApi();
            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            List<SessionFrameMetadataDto.MessageSummary> result = new ArrayList<>();
            for (FluxTable table : tables) {
                for (FluxRecord rec : table.getRecords()) {
                    String msgId   = getString(rec, "msg_id");
                    String msgName = getString(rec, "msg_name");
                    if (msgId != null && !msgId.isBlank()) {
                        result.add(new SessionFrameMetadataDto.MessageSummary(msgId, msgName));
                    }
                }
            }
            return result;
        } catch (Exception e) {
            log.warn("Could not query distinct messages for session {}: {}", sessionId, e.getMessage());
            return List.of();
        }
    }

    // ── Signal count (unchanged, used by pipeline-stats endpoint) ─────────────────

    public long countPoints(String sessionId) {
        try {
            validateSessionId(sessionId);
            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["_field"] == "value")
                  |> count()
                  |> sum()
                """, bucket, sessionId);
            QueryApi queryApi = influxDBClient.getQueryApi();
            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            long total = 0;
            for (FluxTable table : tables) {
                for (FluxRecord record : table.getRecords()) {
                    Object val = record.getValue();
                    if (val instanceof Number) total += ((Number) val).longValue();
                }
            }
            return total;
        } catch (Exception e) {
            log.warn("Could not count InfluxDB signal points for session {}: {}",
                    sessionId, e.getMessage());
            return -1;
        }
    }

    // ── Delete (now covers both measurements) ─────────────────────────────────────

    /**
     * Deletes all can_signals AND can_frames data for the session from InfluxDB.
     * Both deletions are attempted; if either fails, a combined RuntimeException is thrown.
     */
    public void deleteSession(String sessionId) {
        validateSessionId(sessionId);
        evictSessionCache(sessionId);
        String stop = Instant.now().plusSeconds(3600).toString();
        List<String> errors = new ArrayList<>();
        for (String measurement : List.of("can_signals", "can_frames")) {
            try {
                deleteMeasurement(measurement, sessionId, stop);
            } catch (Exception e) {
                log.error("Failed to delete InfluxDB {} for session {}: {}",
                        measurement, sessionId, e.getMessage());
                errors.add(measurement + ": " + e.getMessage());
            }
        }
        if (!errors.isEmpty()) {
            throw new RuntimeException(
                    "InfluxDB delete failed for session " + sessionId + ": "
                    + String.join("; ", errors));
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────────

    private String buildCountFlux(String sessionId, String msgId, String channelName,
                                  List<Long> faultTimestampNanos) {
        StringBuilder sb = new StringBuilder();
        sb.append(String.format("""
            from(bucket: "%s")
              |> range(start: 0)
              |> filter(fn: (r) => r["_measurement"] == "can_frames")
              |> filter(fn: (r) => r["session_id"] == "%s")
              |> filter(fn: (r) => r["_field"] == "direction")
            """, bucket, sessionId));
        if (msgId != null && !msgId.isBlank()) {
            sb.append(String.format("  |> filter(fn: (r) => r[\"msg_id\"] == \"%s\")\n", msgId));
        }
        if (channelName != null && !channelName.isBlank()) {
            sb.append(String.format(
                "  |> filter(fn: (r) => r[\"channel_name\"] == \"%s\")\n", channelName));
        }
        appendFaultFilter(sb, faultTimestampNanos);
        sb.append("  |> count()\n  |> sum()\n");
        return sb.toString();
    }

    private String buildPagedFlux(String sessionId, String msgId, String channelName,
                                  List<Long> faultTimestampNanos, int page, int size) {
        StringBuilder sb = new StringBuilder();
        sb.append(String.format("""
            from(bucket: "%s")
              |> range(start: 0)
              |> filter(fn: (r) => r["_measurement"] == "can_frames")
              |> filter(fn: (r) => r["session_id"] == "%s")
            """, bucket, sessionId));
        if (msgId != null && !msgId.isBlank()) {
            sb.append(String.format("  |> filter(fn: (r) => r[\"msg_id\"] == \"%s\")\n", msgId));
        }
        if (channelName != null && !channelName.isBlank()) {
            sb.append(String.format(
                "  |> filter(fn: (r) => r[\"channel_name\"] == \"%s\")\n", channelName));
        }
        appendFaultFilter(sb, faultTimestampNanos);
        sb.append("""
              |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
              |> group()
              |> sort(columns: ["_time"])
            """);
        sb.append(String.format("  |> limit(n: %d, offset: %d)\n", size, page * size));
        return sb.toString();
    }

    private void appendFaultFilter(StringBuilder sb, List<Long> faultTimestampNanos) {
        if (faultTimestampNanos == null || faultTimestampNanos.isEmpty()) return;
        String nanoSet = faultTimestampNanos.stream()
                .map(String::valueOf)
                .collect(Collectors.joining(", ", "[", "]"));
        sb.append(String.format(
            "  |> filter(fn: (r) => contains(value: int(v: r._time), set: %s))\n", nanoSet));
    }

    private CanFrameResponse recordToResponse(FluxRecord rec, String sessionId) {
        Instant time = rec.getTime();
        Double timestamp = null;
        if (time != null) {
            long nanos = time.getEpochSecond() * 1_000_000_000L + time.getNano();
            timestamp = nanos / 1_000_000_000.0;
        }
        Object chanObj  = rec.getValueByKey("channel");
        Integer channel = chanObj instanceof Number ? ((Number) chanObj).intValue() : null;
        String signals  = getString(rec, "signals_json");
        return new CanFrameResponse(
                null,
                sessionId,
                timestamp,
                channel,
                getString(rec, "channel_name"),
                getString(rec, "msg_id"),
                getString(rec, "msg_name"),
                getString(rec, "direction"),
                getString(rec, "raw_bytes"),
                signals);
    }

    private String getString(FluxRecord rec, String key) {
        Object val = rec.getValueByKey(key);
        return val != null ? val.toString() : null;
    }

    private List<String> queryDistinctTagValues(String sessionId, String tagName) {
        try {
            String flux = String.format("""
                import "influxdata/influxdb/schema"
                schema.tagValues(
                  bucket: "%s",
                  tag: "%s",
                  predicate: (r) => r._measurement == "can_frames" and r.session_id == "%s",
                  start: 0
                )
                |> sort(columns: ["_value"])
                """, bucket, tagName, sessionId);
            QueryApi queryApi = influxDBClient.getQueryApi();
            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            List<String> result = new ArrayList<>();
            for (FluxTable table : tables) {
                for (FluxRecord rec : table.getRecords()) {
                    Object val = rec.getValue();
                    if (val != null && !val.toString().isBlank()) {
                        result.add(val.toString());
                    }
                }
            }
            return result;
        } catch (Exception e) {
            log.warn("Could not query distinct {} for session {}: {}",
                    tagName, sessionId, e.getMessage());
            return List.of();
        }
    }

    private void deleteMeasurement(String measurement, String sessionId, String stop) {
        String url = influxUrl + "/api/v2/delete?org=" + influxOrg + "&bucket=" + bucket;
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Token " + influxToken);
        headers.setContentType(MediaType.APPLICATION_JSON);
        String body = String.format("""
            {
                "start": "2000-01-01T00:00:00Z",
                "stop": "%s",
                "predicate": "_measurement=\\"%s\\" AND session_id=\\"%s\\""
            }
            """, stop, measurement, sessionId);
        restTemplate.postForEntity(url, new HttpEntity<>(body, headers), String.class);
        log.info("Deleted InfluxDB {} data for session: {}", measurement, sessionId);
    }
}
