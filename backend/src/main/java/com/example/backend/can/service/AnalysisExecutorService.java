package com.example.backend.can.service;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Ordered per-session execution lanes for frame analysis.
 *
 * The integrity checks (and the requirements engine that will join them) are
 * inherently sequential per session: each frame is compared against the
 * previous frame's state. Dispatching them on a shared pool
 * ({@code CompletableFuture.runAsync}) let same-session frames run concurrently
 * or out of order, fabricating TIMING_GAP/DUPLICATE faults and swallowing
 * COUNTER_ERRORs. Routing every task for a session to one single-threaded lane
 * preserves Kafka arrival order without serializing unrelated sessions.
 */
@Service
@Slf4j
public class AnalysisExecutorService {

    private static final int LANE_COUNT = 4;

    private final ExecutorService[] lanes = new ExecutorService[LANE_COUNT];

    public AnalysisExecutorService() {
        for (int i = 0; i < LANE_COUNT; i++) {
            String name = "can-analysis-" + i;
            lanes[i] = Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, name);
                t.setDaemon(true);
                return t;
            });
        }
    }

    /** Run {@code task} on the lane owned by this session — same session, same thread, arrival order. */
    public void submit(String sessionId, Runnable task) {
        int lane = Math.floorMod(sessionId != null ? sessionId.hashCode() : 0, LANE_COUNT);
        lanes[lane].execute(task);
    }

    @PreDestroy
    public void shutdown() {
        for (ExecutorService lane : lanes) {
            lane.shutdown();
        }
        try {
            for (ExecutorService lane : lanes) {
                if (!lane.awaitTermination(5, TimeUnit.SECONDS)) {
                    lane.shutdownNow();
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
