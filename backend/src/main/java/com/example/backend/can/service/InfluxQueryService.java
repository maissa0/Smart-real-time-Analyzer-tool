package com.example.backend.can.service;

import com.influxdb.client.InfluxDBClient;
import com.influxdb.client.QueryApi;
import com.influxdb.query.FluxRecord;
import com.influxdb.query.FluxTable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.example.backend.can.dto.SignalTimelinePoint;
import com.example.backend.can.dto.TopMessageIdDto;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class InfluxQueryService {

    private final InfluxDBClient influxDBClient;

    @Value("${influxdb.bucket}")
    private String bucket;

    @Value("${influxdb.org}")
    private String influxOrg;

    /**
     * Validate that a string value is safe to interpolate into a Flux query.
     * Accepts only alphanumeric characters, hyphens, underscores, and dots.
     * Rejects any character that could escape a Flux string literal.
     *
     * @param value  the value to validate
     * @param field  name of the field (for error messages and logging)
     * @throws IllegalArgumentException if value contains invalid characters
     */
    private void validateFluxParam(String value, String field) {
        if (value == null || !value.matches("[a-zA-Z0-9_.\\-]{1,128}")) {
            log.warn("Invalid Flux parameter rejected: field='{}' value='{}'", field, value);
            throw new IllegalArgumentException(
                    "Invalid " + field + " format — only alphanumeric, dot, hyphen and underscore allowed"
            );
        }
    }

    /** Queries all time-ordered samples for one signal within a session. */
    public List<SignalTimelinePoint> querySignalTimeline(
            String sessionId, String signalName, double startTs, double endTs) {
        // Validate both parameters before interpolating into the Flux query
        validateFluxParam(sessionId, "sessionId");
        validateFluxParam(signalName, "signalName");
        try {
            QueryApi queryApi = influxDBClient.getQueryApi();

            // Bounded scan with ±1h margins around the requested window: Influx
            // prunes shards by range before tag filters, so range(start: 0)
            // scanned the whole bucket per call. Some sessions store timestamps
            // that disagree with their point times (e.g. relative-time logs whose
            // points sit at epoch 1970) — when the bounded scan finds nothing,
            // retry once with the full scan so those sessions keep their charts.
            String range = startTs > 0 && endTs > startTs
                    ? String.format("start: %d, stop: %d",
                            (long) Math.floor(startTs) - 3600, (long) Math.ceil(endTs) + 3600)
                    : "start: 0";
            List<SignalTimelinePoint> result = runTimelineQuery(queryApi, range, sessionId, signalName);
            if (result.isEmpty() && !"start: 0".equals(range)) {
                result = runTimelineQuery(queryApi, "start: 0", sessionId, signalName);
            }
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("InfluxDB query failed for signal={} session={}", signalName, sessionId, e);
            return List.of();
        }
    }

    private List<SignalTimelinePoint> runTimelineQuery(
            QueryApi queryApi, String range, String sessionId, String signalName) {
        String flux = String.format("""
            from(bucket: "%s")
              |> range(%s)
              |> filter(fn: (r) => r["_measurement"] == "can_signals")
              |> filter(fn: (r) => r["session_id"] == "%s")
              |> filter(fn: (r) => r["signal_name"] == "%s")
              |> filter(fn: (r) => r["_field"] == "value")
              |> sort(columns: ["_time"])
              |> limit(n: 50000)
            """, bucket, range, sessionId, signalName);

        List<FluxTable> tables = queryApi.query(flux, influxOrg);
        List<SignalTimelinePoint> result = new ArrayList<>();
        for (FluxTable table : tables) {
            for (FluxRecord record : table.getRecords()) {
                result.add(new SignalTimelinePoint(
                        record.getTime() != null ? record.getTime().toString() : null,
                        record.getValue(),
                        record.getValueByKey("label"),
                        record.getValueByKey("msg_id"),
                        record.getValueByKey("signal_name")
                ));
            }
        }
        return result;
    }

    /**
     * Top N most frequent message IDs across all sessions in the last 30 days.
     * Replaces the dead MySQL can_frames query — nothing has written to that table
     * since the InfluxDB frame migration, so canFrameRepository.findTopMsgIds()
     * always returned empty. Scoped to 30 days (not all-time) to bound query cost
     * on this global, cross-session aggregate.
     */
    public List<TopMessageIdDto> queryTopMsgIds(int limit) {
        try {
            QueryApi queryApi = influxDBClient.getQueryApi();
            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: -30d)
                  |> filter(fn: (r) => r["_measurement"] == "can_frames")
                  |> filter(fn: (r) => r["_field"] == "direction")
                  |> group(columns: ["msg_id"])
                  |> count()
                  |> group()
                  |> sort(columns: ["_value"], desc: true)
                  |> limit(n: %d)
                """, bucket, limit);
            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            List<TopMessageIdDto> result = new ArrayList<>();
            for (FluxTable table : tables) {
                for (FluxRecord rec : table.getRecords()) {
                    String msgId = getString(rec, "msg_id");
                    Object val = rec.getValue();
                    if (msgId != null && !msgId.isBlank() && val instanceof Number) {
                        result.add(new TopMessageIdDto(msgId, ((Number) val).longValue()));
                    }
                }
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to query top message IDs: {}", e.getMessage());
            return List.of();
        }
    }

    /** Returns distinct signal names present in Influx for the given session (all time). */
    public List<String> queryAvailableSignals(String sessionId) {
        // Validate before interpolating into the Flux query
        validateFluxParam(sessionId, "sessionId");
        try {
            QueryApi queryApi = influxDBClient.getQueryApi();

            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> keep(columns: ["signal_name"])
                  |> distinct(column: "signal_name")
                """, bucket, sessionId);

            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            List<String> signals = new ArrayList<>();
            for (FluxTable table : tables) {
                for (FluxRecord record : table.getRecords()) {
                    Object val = record.getValue();
                    if (val != null) signals.add(val.toString());
                }
            }
            return signals;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to query available signals for session={}", sessionId, e);
            return List.of();
        }
    }

    /** Returns distinct signal names filtered by optional bus and/or msgId. */
    public List<String> queryAvailableSignals(String sessionId, String bus, String msgId) {
        if ((bus == null || bus.isBlank()) && (msgId == null || msgId.isBlank())) {
            return queryAvailableSignals(sessionId);
        }
        validateFluxParam(sessionId, "sessionId");
        if (bus   != null && !bus.isBlank())   validateFluxParam(bus,   "bus");
        if (msgId != null && !msgId.isBlank()) validateFluxParam(msgId, "msgId");
        try {
            QueryApi queryApi = influxDBClient.getQueryApi();
            StringBuilder flux = new StringBuilder(String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                """, bucket, sessionId));
            if (bus != null && !bus.isBlank())
                flux.append(String.format("  |> filter(fn: (r) => r[\"channel_name\"] == \"%s\")\n", bus));
            if (msgId != null && !msgId.isBlank())
                flux.append(String.format("  |> filter(fn: (r) => r[\"msg_id\"] == \"%s\")\n", msgId));
            flux.append("  |> keep(columns: [\"signal_name\"])\n  |> distinct(column: \"signal_name\")\n");
            List<String> signals = new ArrayList<>();
            for (FluxTable table : queryApi.query(flux.toString(), influxOrg))
                for (FluxRecord record : table.getRecords()) {
                    Object val = record.getValue();
                    if (val != null) signals.add(val.toString());
                }
            return signals;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to query available signals session={} bus={} msgId={}", sessionId, bus, msgId, e);
            return List.of();
        }
    }

    private String getString(FluxRecord rec, String key) {
        Object val = rec.getValueByKey(key);
        return val != null ? val.toString() : null;
    }

    /**
     * Returns all signal values for a session as a map keyed by absolute nanosecond timestamp.
     * Used by CSV export to attach decoded signal values to each frame row without an N+1 query.
     *
     * Key: nanoseconds since Unix epoch (identical formula to InfluxWriteService.writeFrame)
     * Value: map of signalName → raw value string for that frame
     */
    public Map<Long, Map<String, String>> queryFrameSignalsForExport(String sessionId) {
        validateFluxParam(sessionId, "sessionId");
        try {
            QueryApi queryApi = influxDBClient.getQueryApi();
            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["_field"] == "value")
                """, bucket, sessionId);

            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            Map<Long, Map<String, String>> result = new LinkedHashMap<>();
            for (FluxTable table : tables) {
                for (FluxRecord record : table.getRecords()) {
                    if (record.getTime() == null) continue;
                    long nanos = record.getTime().getEpochSecond() * 1_000_000_000L
                               + record.getTime().getNano();
                    Object sigNameObj = record.getValueByKey("signal_name");
                    Object valueObj   = record.getValue();
                    if (sigNameObj == null || valueObj == null) continue;
                    result.computeIfAbsent(nanos, k -> new LinkedHashMap<>())
                          .put(sigNameObj.toString(), valueObj.toString());
                }
            }
            log.info("CSV export signal map size: {} timestamp buckets for session={}", result.size(), sessionId);
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to query signals for export, session={}", sessionId, e);
            return Map.of();
        }
    }

    /**
     * Returns signals for a nanosecond timestamp range within a session.
     * Used to enrich paginated frame responses with their decoded signals in one batch query.
     *
     * Key: nanoseconds since Unix epoch (same formula as InfluxWriteService.writeFrame)
     * Value: ordered list of {signal_name, raw_value, label} maps — JSON-ready for the frontend
     */
}
