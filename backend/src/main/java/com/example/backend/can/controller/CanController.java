package com.example.backend.can.controller;

import com.example.backend.audit.AuditLog;
import com.example.backend.can.dto.CanFrameResponse;
import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.service.CanSessionService;
import com.example.backend.can.service.InfluxWriteService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
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
    public ResponseEntity<?> getFrames(
            @PathVariable String sessionId,
            @RequestParam(required = false) String msgId,
            @RequestParam(required = false, defaultValue = "false") boolean faultsOnly,
            @RequestParam(required = false, defaultValue = "false") boolean anomalyOnly,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false, defaultValue = "500") int size) {

        // faultsOnly — always returns full list (filter overrides pagination)
        if (faultsOnly) {
            return ResponseEntity.ok(canSessionService.getFramesWithFaults(sessionId));
        }
        // anomalyOnly — placeholder (AI sprint not yet implemented)
        if (anomalyOnly) {
            return ResponseEntity.ok(List.of());
        }

        // Paginated mode — when page param is present
        if (page != null) {
            if (msgId != null && !msgId.isBlank()) {
                return ResponseEntity.ok(
                    canSessionService.getFramesBySessionAndMsgIdPaged(
                        sessionId, msgId, page, size));
            }
            return ResponseEntity.ok(
                canSessionService.getFramesBySessionPaged(sessionId, page, size));
        }

        // Backward-compatible non-paginated mode (no page param)
        if (msgId != null && !msgId.isBlank()) {
            return ResponseEntity.ok(
                canSessionService.getFramesBySessionAndMsgId(sessionId, msgId));
        }
        return ResponseEntity.ok(canSessionService.getFramesBySession(sessionId));
    }

    /**
     * Frame count for a session — used by pagination UI to compute total pages.
     * GET /api/can/sessions/{sessionId}/frame-count
     */
    @GetMapping("/sessions/{sessionId}/frame-count")
    public ResponseEntity<Map<String, Object>> getFrameCount(
            @PathVariable String sessionId) {
        long count = canSessionService.getFrameCount(sessionId);
        Map<String, Object> body = new HashMap<>();
        body.put("sessionId", sessionId);
        body.put("count", count);
        return ResponseEntity.ok(body);
    }

    @GetMapping("/sessions/{sessionId}/pipeline-stats")
    public ResponseEntity<Map<String, Object>> getPipelineStats(
            @PathVariable String sessionId) {
        long mysqlFrames = canSessionService.getFrameCount(sessionId);
        long influxPoints = influxWriteService.countPoints(sessionId);
        return ResponseEntity.ok(Map.of(
                "sessionId",    sessionId,
                "mysqlFrames",  mysqlFrames,
                "influxPoints", influxPoints
        ));
    }

    /**
     * Export all frames for a session as CSV.
     * GET /api/can/sessions/{sessionId}/frames/export.csv
     */
    @AuditLog(action = "LOG_EXPORT", resource = "sessions", resourceIdParam = "sessionId")
    @GetMapping("/sessions/{sessionId}/frames/export.csv")
    public ResponseEntity<String> exportFramesCsv(
            @PathVariable String sessionId) {
        List<CanFrameResponse> frames =
                canSessionService.getFramesBySession(sessionId);

        StringBuilder csv = new StringBuilder();
        csv.append("id,sessionId,timestamp,channel,channelName,")
           .append("msgId,msgName,direction,rawBytes\n");

        for (CanFrameResponse f : frames) {
            csv.append(f.id()).append(',')
               .append(f.sessionId()).append(',')
               .append(f.timestamp()).append(',')
               .append(f.channel() != null ? f.channel().toString() : "").append(',')
               .append(escapeCsv(f.channelName())).append(',')
               .append(escapeCsv(f.msgId())).append(',')
               .append(escapeCsv(f.msgName())).append(',')
               .append(escapeCsv(f.direction())).append(',')
               .append(escapeCsv(f.rawBytes())).append('\n');
        }

        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"session-" + sessionId + ".csv\"");
        headers.add(HttpHeaders.CONTENT_TYPE, "text/csv; charset=UTF-8");

        return ResponseEntity.ok()
                .headers(headers)
                .body(csv.toString());
    }

    private String escapeCsv(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    @AuditLog(action = "SESSION_DELETE", resource = "sessions", resourceIdParam = "sessionId")
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
