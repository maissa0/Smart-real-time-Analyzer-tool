package com.example.backend.can.controller;

import com.example.backend.can.service.PlaybackService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/playback")
@RequiredArgsConstructor
@Slf4j
public class PlaybackController {

    private final PlaybackService playbackService;

    /**
     * Start a new playback session streaming from InfluxDB via WebSocket.
     * Client should subscribe to /topic/playback/{sessionId} before calling this.
     */
    @PostMapping("/start")
    public ResponseEntity<Map<String, Object>> start(
            @RequestBody Map<String, Object> request) {
        try {
            String sessionId = (String) request.get("sessionId");
            double startTs = ((Number) request.getOrDefault("startTs", 0.0)).doubleValue();
            double endTs = ((Number) request.getOrDefault("endTs", 0.0)).doubleValue();
            double speed = ((Number) request.getOrDefault("speed", 1.0)).doubleValue();

            @SuppressWarnings("unchecked")
            List<String> signals = (List<String>) request.get("signals");

            if (sessionId == null || sessionId.isEmpty()) {
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "sessionId is required"));
            }

            String playbackId = playbackService.startPlayback(
                    sessionId, startTs, endTs, speed, signals);

            return ResponseEntity.ok(Map.of(
                    "playbackId", playbackId,
                    "sessionId", sessionId,
                    "status", "started",
                    "topic", "/topic/playback/" + sessionId
            ));

        } catch (Exception e) {
            log.error("Failed to start playback", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Unknown error"));
        }
    }

    /**
     * Stop an active playback.
     */
    @PostMapping("/stop/{playbackId}")
    public ResponseEntity<Map<String, String>> stop(
            @PathVariable String playbackId) {
        boolean stopped = playbackService.stopPlayback(playbackId);
        if (stopped) {
            return ResponseEntity.ok(Map.of(
                    "playbackId", playbackId,
                    "status", "stopped"
            ));
        }
        return ResponseEntity.notFound().build();
    }

    /**
     * Check if a playback is currently active.
     */
    @GetMapping("/status/{playbackId}")
    public ResponseEntity<Map<String, Object>> status(
            @PathVariable String playbackId) {
        boolean active = playbackService.isActive(playbackId);
        Map<String, Object> body = new HashMap<>();
        body.put("playbackId", playbackId);
        body.put("active", active);
        return ResponseEntity.ok(body);
    }
}
