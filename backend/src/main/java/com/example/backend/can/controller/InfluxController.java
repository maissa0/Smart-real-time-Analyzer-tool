package com.example.backend.can.controller;

import com.example.backend.can.dto.SignalTimelinePoint;
import com.example.backend.can.service.InfluxQueryService;
import com.example.backend.can.service.InfluxWriteService;
import com.example.backend.exception.SafeErrorMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/can/influx")
@RequiredArgsConstructor
@Slf4j
public class InfluxController {

    private final InfluxQueryService influxQueryService;
    private final InfluxWriteService influxWriteService;

    /** Lists signal names stored in Influx for the session. */
    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/signals")
    public ResponseEntity<List<String>> getAvailableSignals(
            @PathVariable String sessionId) {
        return ResponseEntity.ok(influxQueryService.queryAvailableSignals(sessionId));
    }

    /** Returns timeline rows (time, value, tags) for one signal between startTs and endTs (Unix seconds). */
    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/timeline")
    public ResponseEntity<List<SignalTimelinePoint>> getSignalTimeline(
            @PathVariable String sessionId,
            @RequestParam String signalName,
            @RequestParam double startTs,
            @RequestParam double endTs) {
        return ResponseEntity.ok(
            influxQueryService.querySignalTimeline(sessionId, signalName, startTs, endTs)
        );
    }

    @PreAuthorize("hasRole('ADMIN')")
    @DeleteMapping("/sessions/{sessionId}")
    public ResponseEntity<Map<String, String>> deleteSession(@PathVariable String sessionId) {
        try {
            influxWriteService.deleteSession(sessionId);
            return ResponseEntity.ok(Map.of(
                "status", "success",
                "message", "InfluxDB data deleted for session: " + sessionId
            ));
        } catch (Exception e) {
            log.error("Failed to delete InfluxDB data for session {}: {}", sessionId, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of(
                "status", "error",
                "message", SafeErrorMessage.of(e, "Failed to delete InfluxDB data")
            ));
        }
    }
}
