package com.example.backend.can.service;

import com.example.backend.can.dto.FaultContextSignal;
import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.influxdb.client.InfluxDBClient;
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

/**
 * Back-fills per-fault operating context for sessions recorded before context was captured
 * at detection time. Runs one batched InfluxDB query per session for the vehicle-state
 * signals, then correlates each fault to the latest reading at or before its timestamp in
 * memory. Filled context is persisted so the work happens once per session.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DiagnosticEnrichmentService {

    private final InfluxDBClient influxDBClient;
    private final IntegrityFaultRepository faultRepository;
    private final ObjectMapper objectMapper;

    @Value("${influxdb.bucket}")
    private String bucket;

    @Value("${influxdb.org}")
    private String influxOrg;

    /** One time-ordered InfluxDB sample of a context signal. */
    private record Sample(double timeSec, Object value, String label) {}

    /**
     * Fill {@code contextJson} for any fault in the list that is missing it, using InfluxDB.
     * Mutates the passed entities and persists the ones it fills. Best-effort — logs and
     * returns quietly on any query failure so fault listing never breaks.
     */
    public void backfillContext(String sessionId, List<IntegrityFaultEntity> faults) {
        List<IntegrityFaultEntity> missing = faults.stream()
                .filter(f -> f.getContextJson() == null || f.getContextJson().isBlank())
                .filter(f -> f.getFrameTimestamp() != null)
                .toList();
        if (missing.isEmpty()) {
            return;
        }

        Map<String, List<Sample>> series = queryContextSeries(sessionId);
        if (series.isEmpty()) {
            return;
        }

        List<IntegrityFaultEntity> filled = new ArrayList<>();
        for (IntegrityFaultEntity fault : missing) {
            List<FaultContextSignal> context = snapshotAt(series, fault.getFrameTimestamp());
            if (context.isEmpty()) {
                continue;
            }
            try {
                fault.setContextJson(objectMapper.writeValueAsString(context));
                filled.add(fault);
            } catch (Exception e) {
                log.warn("Failed to serialize back-filled context for fault {}: {}", fault.getId(), e.getMessage());
            }
        }

        if (!filled.isEmpty()) {
            try {
                faultRepository.saveAll(filled);
                log.info("Back-filled operating context for {} fault(s) in session {}", filled.size(), sessionId);
            } catch (Exception e) {
                log.warn("Failed to persist back-filled context for session {}: {}", sessionId, e.getMessage());
            }
        }
    }

    /**
     * One batched query returning every vehicle-state sample for the session, grouped by
     * signal name and time-ordered.
     */
    private Map<String, List<Sample>> queryContextSeries(String sessionId) {
        if (!isSafe(sessionId)) {
            log.warn("Rejected unsafe sessionId for context back-fill: {}", sessionId);
            return Map.of();
        }

        String nameSet = String.join(", ", VehicleStateSignals.ALL.stream().map(n -> "\"" + n + "\"").toList());
        String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["_field"] == "value")
                  |> filter(fn: (r) => contains(value: r["signal_name"], set: [%s]))
                  |> sort(columns: ["_time"])
                """, bucket, sessionId, nameSet);

        Map<String, List<Sample>> series = new LinkedHashMap<>();
        try {
            for (FluxTable table : influxDBClient.getQueryApi().query(flux, influxOrg)) {
                for (FluxRecord record : table.getRecords()) {
                    Object nameObj = record.getValueByKey("signal_name");
                    if (nameObj == null || record.getTime() == null) {
                        continue;
                    }
                    String name = nameObj.toString();
                    Object label = record.getValueByKey("label");
                    double timeSec = record.getTime().toEpochMilli() / 1000.0;
                    series.computeIfAbsent(name, k -> new ArrayList<>())
                            .add(new Sample(timeSec, record.getValue(), label != null ? label.toString() : null));
                }
            }
        } catch (Exception e) {
            log.warn("Context back-fill query failed for session {}: {}", sessionId, e.getMessage());
            return Map.of();
        }
        return series;
    }

    /**
     * For each context signal with data, pick the latest sample at or before {@code tsSec}
     * (falling back to the earliest sample when the fault predates the first reading).
     * Iterates {@link VehicleStateSignals#ALL} so the output order is stable.
     */
    private List<FaultContextSignal> snapshotAt(Map<String, List<Sample>> series, double tsSec) {
        List<FaultContextSignal> out = new ArrayList<>();
        for (String name : VehicleStateSignals.ALL) {
            List<Sample> samples = series.get(name);
            if (samples == null || samples.isEmpty()) {
                continue;
            }
            Sample chosen = null;
            for (Sample s : samples) {
                if (s.timeSec() <= tsSec) {
                    chosen = s;
                } else {
                    break; // samples are time-ordered
                }
            }
            if (chosen == null) {
                chosen = samples.get(0);
            }
            out.add(new FaultContextSignal(name, chosen.value(), chosen.label()));
        }
        return out;
    }

    /** Guard sessionId before interpolating into Flux (same policy as InfluxQueryService). */
    private boolean isSafe(String value) {
        return value != null && value.matches("[a-zA-Z0-9_.\\-]{1,128}");
    }
}
