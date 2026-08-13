package com.example.backend.can.controller;

import com.example.backend.can.dto.PlaybackStartRequest;
import com.example.backend.can.dto.PlaybackStartResponse;
import com.example.backend.can.dto.PlaybackStatusResponse;
import com.example.backend.can.service.PlaybackService;
import com.example.backend.exception.SafeErrorMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

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
    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @PostMapping("/start")
    public ResponseEntity<?> start(@RequestBody PlaybackStartRequest request) {
        try {
            if (request.sessionId() == null || request.sessionId().isEmpty()) {
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "sessionId is required"));
            }
            double startTs = request.startTs() != null ? request.startTs() : 0.0;
            double endTs   = request.endTs()   != null ? request.endTs()   : 0.0;
            double speed   = request.speed()   != null ? request.speed()   : 1.0;

            String playbackId = playbackService.startPlayback(
                    request.sessionId(), startTs, endTs, speed, request.signals(),
                    Boolean.TRUE.equals(request.includeUndecoded()));

            return ResponseEntity.ok(new PlaybackStartResponse(
                    playbackId, request.sessionId(), "started",
                    "/topic/playback/" + request.sessionId()));

        } catch (Exception e) {
            log.error("Failed to start playback", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to start playback")));
        }
    }

    /**
     * Stop an active playback.
     */
    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
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
    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/status/{playbackId}")
    public ResponseEntity<PlaybackStatusResponse> status(@PathVariable String playbackId) {
        return ResponseEntity.ok(
                new PlaybackStatusResponse(playbackId, playbackService.isActive(playbackId)));
    }
}
