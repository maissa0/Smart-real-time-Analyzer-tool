package com.example.backend.can.service;

import com.influxdb.client.InfluxDBClient;
import com.influxdb.client.QueryApi;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import jakarta.annotation.PreDestroy;

import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

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
    /**
     * Fixed thread pool — limits concurrent playback sessions to 10.
     * Prevents unbounded thread creation under load.
     * newCachedThreadPool() could spawn thousands of threads with many users.
     */
    private final ExecutorService executor = Executors.newFixedThreadPool(10);

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
     * Graceful shutdown — called by Spring on application stop.
     * Prevents thread leak when the application is restarted.
     */
    @PreDestroy
    public void shutdown() {
        log.info("Shutting down PlaybackService executor...");
        executor.shutdown();
        activePlaybacks.forEach((id, future) -> future.cancel(true));
        activePlaybacks.clear();
        log.info("PlaybackService executor shut down.");
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

        String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_signals")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["_field"] == "value")
                  %s
                  |> group(columns: ["session_id", "signal_name", "msg_id", "msg_name", "channel_name"])
                  |> sort(columns: ["_time"])
                """, bucket, sessionId, signalFilter);

        log.info("Playback query started: id={} signals={}", playbackId, signals);

        // Send start event to client
        Map<String, Object> startEvent = new HashMap<>();
        startEvent.put("type", "start");
        startEvent.put("playbackId", playbackId);
        startEvent.put("sessionId", sessionId);
        startEvent.put("speed", speed);
        startEvent.put("sessionStartTs", startTs); // pass exact startTs to Angular
        messagingTemplate.convertAndSend("/topic/playback/" + sessionId, startEvent);

        log.info("Playback streaming query started: id={} signals={}", playbackId, signals);

        /* Streaming via callback API — influxdb-client-java 7.1 has no QueryApi.queryStream(...).
           Records are processed incrementally instead of buffering List<FluxTable>. */
        final int[] pointCount = {0};
        CountDownLatch streamDone = new CountDownLatch(1);
        AtomicReference<Throwable> streamError = new AtomicReference<>();

        queryApi.query(
                flux,
                influxOrg,
                (cancellable, record) -> {
                    if (Thread.currentThread().isInterrupted()) {
                        cancellable.cancel();
                        return;
                    }
                    Map<String, Object> point = new LinkedHashMap<>();
                    point.put("type", "point");
                    point.put("playbackId", playbackId);
                    point.put("sessionId", sessionId);
                    long millis = record.getTime() != null ? record.getTime().toEpochMilli() : 0L;
                    point.put("time", millis / 1000.0);
                    point.put("value", record.getValue());
                    point.put("signalName", record.getValueByKey("signal_name"));
                    point.put("label", record.getValueByKey("label"));
                    point.put("msgId", record.getValueByKey("msg_id"));
                    point.put("msgName", record.getValueByKey("msg_name"));
                    point.put("channelName", record.getValueByKey("channel_name"));
                    messagingTemplate.convertAndSend("/topic/playback/" + sessionId, point);
                    pointCount[0]++;
                },
                err -> {
                    streamError.set(err);
                    streamDone.countDown();
                },
                streamDone::countDown
        );

        try {
            boolean completed = streamDone.await(5, TimeUnit.MINUTES);
            if (!completed) {
                log.error("Playback stream timed out after 5 minutes: id={}", playbackId);
                throw new RuntimeException("Playback stream timed out after 5 minutes");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("Playback interrupted: id={}", playbackId);
        }

        Throwable fatal = streamError.get();
        if (fatal != null) {
            if (fatal instanceof RuntimeException re) {
                throw re;
            }
            throw new RuntimeException(fatal);
        }

        log.info("Playback streaming complete: id={} points={}", playbackId, pointCount[0]);

        // Send completion event
        Map<String, Object> done = new HashMap<>();
        done.put("type", "complete");
        done.put("playbackId", playbackId);
        done.put("totalPoints", pointCount[0]);
        messagingTemplate.convertAndSend(
                "/topic/playback/" + sessionId,
                done
        );
    }
}
