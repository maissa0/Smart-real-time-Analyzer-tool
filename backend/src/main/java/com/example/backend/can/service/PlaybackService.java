package com.example.backend.can.service;

import com.influxdb.client.InfluxDBClient;
import com.influxdb.client.QueryApi;
import com.influxdb.query.FluxRecord;
import com.influxdb.query.FluxTable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

@Service
@RequiredArgsConstructor
@Slf4j
public class PlaybackService {

    private final InfluxDBClient influxDBClient;
    private final SimpMessagingTemplate messagingTemplate;

    @Value("${influxdb.bucket}")
    private String bucket;

    @Value("${influxdb.org}")
    private String influxOrg;

    // Active playback jobs — keyed by playbackId
    private final Map<String, Future<?>> activePlaybacks = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    /**
     * Start streaming signal points from InfluxDB to WebSocket.
     * Returns a playbackId that can be used to stop the playback.
     */
    public String startPlayback(
            String sessionId,
            double startTs,
            double endTs,
            double speed,
            List<String> signals) {

        String playbackId = UUID.randomUUID().toString();

        Future<?> future = executor.submit(() -> {
            try {
                runPlayback(playbackId, sessionId, startTs, endTs, speed, signals);
            } catch (Exception e) {
                log.error("Playback error: {}", playbackId, e);
                Map<String, Object> err = new HashMap<>();
                err.put("type", "error");
                err.put("playbackId", playbackId);
                err.put("message", e.getMessage() != null ? e.getMessage() : "Unknown error");
                messagingTemplate.convertAndSend(
                        "/topic/playback/" + sessionId,
                        err
                );
            } finally {
                activePlaybacks.remove(playbackId);
                log.info("Playback complete: {}", playbackId);
            }
        });

        activePlaybacks.put(playbackId, future);
        log.info("Playback started: id={} session={} speed={}x", playbackId, sessionId, speed);
        return playbackId;
    }

    /**
     * Stop an active playback by cancelling its future.
     */
    public boolean stopPlayback(String playbackId) {
        Future<?> future = activePlaybacks.remove(playbackId);
        if (future != null) {
            future.cancel(true);
            log.info("Playback stopped: {}", playbackId);
            return true;
        }
        return false;
    }

    /**
     * Check if a playback is currently active.
     */
    public boolean isActive(String playbackId) {
        Future<?> f = activePlaybacks.get(playbackId);
        return f != null && !f.isDone() && !f.isCancelled();
    }

    /**
     * Core playback loop — queries InfluxDB and streams points via WebSocket.
     */
    private void runPlayback(
            String playbackId,
            String sessionId,
            double startTs,
            double endTs,
            double speed,
            List<String> signals) {

        QueryApi queryApi = influxDBClient.getQueryApi();

        // Build signal filter
        String signalFilter = signals == null || signals.isEmpty()
                ? ""
                : String.format(
                        "|> filter(fn: (r) => contains(value: r[\"signal_name\"], set: [%s]))",
                        signals.stream()
                                .map(s -> "\"" + s + "\"")
                                .reduce((a, b) -> a + ", " + b)
                                .orElse("")
                );

        String startRfc = Instant.ofEpochSecond((long) startTs).toString();
        String stopRfc = Instant.ofEpochSecond((long) endTs + 1).toString();

        String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: %s, stop: %s)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["_field"] == "value")
                  %s
                  |> sort(columns: ["_time"])
                """, bucket, startRfc, stopRfc, sessionId, signalFilter);

        log.info("Playback query started: id={} signals={}", playbackId, signals);

        // Send start event to client
        Map<String, Object> startEvent = new HashMap<>();
        startEvent.put("type", "start");
        startEvent.put("playbackId", playbackId);
        startEvent.put("sessionId", sessionId);
        startEvent.put("speed", speed);
        startEvent.put("sessionStartTs", startTs); // pass exact startTs to Angular
        messagingTemplate.convertAndSend("/topic/playback/" + sessionId, startEvent);

        List<FluxTable> tables = queryApi.query(flux, influxOrg);

        // Collect all records sorted by time
        List<Map<String, Object>> records = new ArrayList<>();
        for (FluxTable table : tables) {
            for (FluxRecord record : table.getRecords()) {
                Map<String, Object> point = new LinkedHashMap<>();
                point.put("type", "point");
                point.put("playbackId", playbackId);
                point.put("sessionId", sessionId);
                // Use nanosecond precision to avoid floating point loss
                long nanos = record.getTime() != null ? record.getTime().toEpochMilli() : 0L;
                point.put("time", nanos / 1000.0); // convert to seconds with ms precision
                point.put("value", record.getValue());
                point.put("signalName", record.getValueByKey("signal_name"));
                point.put("label", record.getValueByKey("label"));
                point.put("msgId", record.getValueByKey("msg_id"));
                point.put("msgName", record.getValueByKey("msg_name"));
                point.put("channelName", record.getValueByKey("channel_name"));
                records.add(point);
            }
        }

        // Sort all records by time
        records.sort(Comparator.comparingDouble(r -> ((Number) r.get("time")).doubleValue()));

        log.info("Playback streaming {} points: id={}", records.size(), playbackId);

        // Send all points immediately — Angular handles timing using timestamps
        for (Map<String, Object> point : records) {
            if (Thread.currentThread().isInterrupted()) {
                break;
            }
            messagingTemplate.convertAndSend("/topic/playback/" + sessionId, point);
        }

        // Send completion event
        Map<String, Object> done = new HashMap<>();
        done.put("type", "complete");
        done.put("playbackId", playbackId);
        done.put("totalPoints", records.size());
        messagingTemplate.convertAndSend(
                "/topic/playback/" + sessionId,
                done
        );
    }
}
