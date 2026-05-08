package com.example.backend.can.controller;

import com.example.backend.can.dto.CanFrameResponse;
import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.service.CanSessionService;
import com.example.backend.can.service.InfluxWriteService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/can")
@RequiredArgsConstructor
public class CanController {

    private final CanSessionService canSessionService;
    private final InfluxWriteService influxWriteService;

    @GetMapping("/sessions")
    public ResponseEntity<?> getSessions(
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        // If no pagination params, return all sessions (backward compatible)
        if (page == null || size == null) {
            return ResponseEntity.ok(canSessionService.getAllSessions());
        }
        return ResponseEntity.ok(canSessionService.getSessions(page, size));
    }

    @GetMapping("/sessions/{sessionId}/frames")
    public ResponseEntity<List<CanFrameResponse>> getFrames(
            @PathVariable String sessionId,
            @RequestParam(required = false) String msgId) {
        if (msgId != null) {
            return ResponseEntity.ok(canSessionService.getFramesBySessionAndMsgId(sessionId, msgId));
        }
        return ResponseEntity.ok(canSessionService.getFramesBySession(sessionId));
    }

    @DeleteMapping("/sessions/{sessionId}")
    public ResponseEntity<Map<String, Object>> deleteSession(@PathVariable String sessionId) {
        try {
            // Delete from MySQL (frames, faults, session row)
            Map<String, Object> mysqlResult = canSessionService.deleteSession(sessionId);

            // Delete from InfluxDB (signal time-series data)
            influxWriteService.deleteSession(sessionId);

            Map<String, Object> response = new HashMap<>(mysqlResult);
            response.put("influxDeleted", true);
            return ResponseEntity.ok(response);

        } catch (RuntimeException e) {
            if (e.getMessage().contains("Session not found")) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.internalServerError().body(Map.of(
                    "status", "error",
                    "message", e.getMessage()
            ));
        }
    }
}
