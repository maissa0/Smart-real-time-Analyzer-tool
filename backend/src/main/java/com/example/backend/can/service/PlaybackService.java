package com.example.backend.can.service;

import com.influxdb.client.InfluxDBClient;
import com.influxdb.client.QueryApi;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import com.example.backend.can.dto.PlaybackCompleteEvent;
import com.example.backend.can.dto.PlaybackErrorEvent;
import com.example.backend.can.dto.PlaybackPointEvent;
import com.example.backend.can.dto.PlaybackStartEvent;

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
            List<String> signals,
            boolean includeUndecoded) {

        String playbackId = UUID.randomUUID().toString();

        Future<?> future = executor.submit(() -> {
            try {
                runPlayback(playbackId, sessionId, startTs, endTs, speed, signals, includeUndecoded);
            } catch (Exception e) {
                log.error("Playback error: {}", playbackId, e);
                messagingTemplate.convertAndSend(
                        "/topic/playback/" + sessionId,
                        new PlaybackErrorEvent("error", playbackId,
                                e.getMessage() != null ? e.getMessage() : "Unknown error"));
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
            List<String> signals,
            boolean includeUndecoded) {

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

        // Bounded scan with ±1h margins instead of the whole bucket: Influx prunes
        // shards by range BEFORE tag filters, so range(start: 0) re-read every
        // stored session on each load and chart loading degraded linearly with
        // bucket size. The margins absorb the two hazards the full scan guarded
        // against — Kafka-lagged frames timestamped past the recorded endTs, and
        // (long) truncation of the fractional startTs. Sessions without usable
        // timestamps still fall back to the full scan.
        String rangeClause = startTs > 0 && endTs > startTs
                ? String.format("start: %d, stop: %d",
                        (long) Math.floor(startTs) - 3600, (long) Math.ceil(endTs) + 3600)
                : "start: 0";

        log.info("Playback query started: id={} signals={}", playbackId, signals);

        // Send start event to client
        messagingTemplate.convertAndSend("/topic/playback/" + sessionId,
                new PlaybackStartEvent("start", playbackId, sessionId, speed, startTs));

        /* Streaming via callback API — influxdb-client-java 7.1 has no QueryApi.queryStream(...).
           Records are processed incrementally instead of buffering List<FluxTable>. */
        final int[] pointCount = {0};

        /* Points are batched into one STOMP message per BATCH_SIZE records.
           Sending each point individually meant tens of thousands of WebSocket
           messages for large sessions — serialization + framing dominated load time.
           The Angular LiveTelemetryService accepts both a single event and an array. */
        final int BATCH_SIZE = 500;
        final java.util.List<PlaybackPointEvent> batch = new java.util.ArrayList<>(BATCH_SIZE);

        // Bounded scan first; some sessions store timestamps that disagree with
        // their point times (e.g. relative-time logs whose points sit at epoch
        // 1970), so when the bounded scan streams nothing, retry once with the
        // full scan so no session loses its charts.
        String[] clauses = "start: 0".equals(rangeClause)
                ? new String[]{ "start: 0" }
                : new String[]{ rangeClause, "start: 0" };

        for (String clause : clauses) {
            String flux = String.format("""
                    from(bucket: "%s")
                      |> range(%s)
                      |> filter(fn: (r) => r["_measurement"] == "can_signals")
                      |> filter(fn: (r) => r["session_id"] == "%s")
                      |> filter(fn: (r) => r["_field"] == "value")
                      %s
                      |> group(columns: ["session_id", "signal_name", "msg_id", "msg_name", "channel_name"])
                      |> sort(columns: ["_time"])
                    """, bucket, clause, sessionId, signalFilter);

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
                        long millis = record.getTime() != null ? record.getTime().toEpochMilli() : 0L;
                        Object rawValue = record.getValue();
                        Double typedValue = rawValue instanceof Number n ? n.doubleValue() : null;
                        batch.add(new PlaybackPointEvent(
                                "point", playbackId, sessionId,
                                millis / 1000.0,
                                typedValue,
                                asString(record.getValueByKey("signal_name")),
                                asString(record.getValueByKey("label")),
                                asString(record.getValueByKey("msg_id")),
                                asString(record.getValueByKey("msg_name")),
                                asString(record.getValueByKey("channel_name"))));
                        if (batch.size() >= BATCH_SIZE) {
                            messagingTemplate.convertAndSend("/topic/playback/" + sessionId,
                                    java.util.List.copyOf(batch));
                            batch.clear();
                        }
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

            if (pointCount[0] > 0) {
                break;
            }
            if (!"start: 0".equals(clause)) {
                log.info("Bounded playback scan found no points — retrying full scan: id={}", playbackId);
            }
        }

        // Frames whose msg ID has no catalogue entry decode to zero signals, so the
        // can_signals query above never sees them. When the client opted in, stream
        // them as value-less points (signalName/value/label null, msgId/msgName set)
        // so it can surface "undecodable" traffic on the timeline. Non-fatal on error.
        if (includeUndecoded) {
            streamUndecodedFrames(playbackId, sessionId, batch, pointCount);
        }

        // Flush the final partial batch. Safe: the query callbacks have finished
        // (latches awaited), so no concurrent writes to `batch` remain.
        if (!batch.isEmpty()) {
            messagingTemplate.convertAndSend("/topic/playback/" + sessionId,
                    java.util.List.copyOf(batch));
            batch.clear();
        }

        log.info("Playback streaming complete: id={} points={}", playbackId, pointCount[0]);

        // Send completion event
        messagingTemplate.convertAndSend("/topic/playback/" + sessionId,
                new PlaybackCompleteEvent("complete", playbackId, pointCount[0]));
    }

    /**
     * Streams frames with no catalogue entry (msg_name = "UNKNOWN") as value-less
     * playback points, appended to the caller's batch. Errors are logged, not fatal —
     * decoded-signal playback must not fail because this auxiliary query did.
     */
    private void streamUndecodedFrames(
            String playbackId,
            String sessionId,
            List<PlaybackPointEvent> batch,
            int[] pointCount) {

        String flux = String.format("""
                from(bucket: "%s")
                  |> range(start: 0)
                  |> filter(fn: (r) => r["_measurement"] == "can_frames")
                  |> filter(fn: (r) => r["session_id"] == "%s")
                  |> filter(fn: (r) => r["msg_name"] == "UNKNOWN")
                  |> filter(fn: (r) => r["_field"] == "channel")
                  |> sort(columns: ["_time"])
                """, bucket, sessionId);

        CountDownLatch done = new CountDownLatch(1);
        influxDBClient.getQueryApi().query(
                flux,
                influxOrg,
                (cancellable, record) -> {
                    if (Thread.currentThread().isInterrupted()) {
                        cancellable.cancel();
                        return;
                    }
                    long millis = record.getTime() != null ? record.getTime().toEpochMilli() : 0L;
                    batch.add(new PlaybackPointEvent(
                            "point", playbackId, sessionId,
                            millis / 1000.0,
                            null, null, null,
                            asString(record.getValueByKey("msg_id")),
                            asString(record.getValueByKey("msg_name")),
                            asString(record.getValueByKey("channel_name"))));
                    if (batch.size() >= 500) {
                        messagingTemplate.convertAndSend("/topic/playback/" + sessionId,
                                java.util.List.copyOf(batch));
                        batch.clear();
                    }
                    pointCount[0]++;
                },
                err -> {
                    log.warn("Undecoded-frame query failed (non-fatal): id={} — {}",
                            playbackId, err.getMessage());
                    done.countDown();
                },
                done::countDown
        );

        try {
            if (!done.await(60, TimeUnit.SECONDS)) {
                log.warn("Undecoded-frame query timed out (non-fatal): id={}", playbackId);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Safely converts an InfluxDB tag/field Object to String, returning null for null inputs. */
    private static String asString(Object value) {
        return value != null ? value.toString() : null;
    }
}
