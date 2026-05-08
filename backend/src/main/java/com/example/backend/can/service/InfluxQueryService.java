package com.example.backend.can.service;

import com.influxdb.client.InfluxDBClient;
import com.influxdb.client.QueryApi;
import com.influxdb.query.FluxRecord;
import com.influxdb.query.FluxTable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

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

    /** Queries time-ordered samples for one signal within a session and Unix second range. */
    public List<Map<String, Object>> querySignalTimeline(
            String sessionId, String signalName, double startTs, double endTs) {
        try {
            QueryApi queryApi = influxDBClient.getQueryApi();

            // Convert Unix seconds to RFC3339
            String startRfc = java.time.Instant.ofEpochSecond((long) startTs).toString();
            String stopRfc  = java.time.Instant.ofEpochSecond((long) endTs + 1).toString();

            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: %s, stop: %s)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["signal_name"] == "%s")
                  |> filter(fn: (r) => r["_field"] == "value")
                  |> sort(columns: ["_time"])
                """, bucket, startRfc, stopRfc, sessionId, signalName);

            List<FluxTable> tables = queryApi.query(flux, influxOrg);
            List<Map<String, Object>> result = new ArrayList<>();

            for (FluxTable table : tables) {
                for (FluxRecord record : table.getRecords()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("time", record.getTime() != null ? record.getTime().toString() : null);
                    row.put("value", record.getValue());
                    row.put("label", record.getValueByKey("label"));
                    row.put("msgId", record.getValueByKey("msg_id"));
                    row.put("signalName", record.getValueByKey("signal_name"));
                    result.add(row);
                }
            }
            return result;

        } catch (Exception e) {
            log.error("InfluxDB query failed for signal={} session={}", signalName, sessionId, e);
            return List.of();
        }
    }

    /** Returns distinct signal names present in Influx for the given session (last 30 days). */
    public List<String> queryAvailableSignals(String sessionId) {
        try {
            QueryApi queryApi = influxDBClient.getQueryApi();
            String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: -30d)
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
        } catch (Exception e) {
            log.error("Failed to query available signals for session={}", sessionId, e);
            return List.of();
        }
    }
}
