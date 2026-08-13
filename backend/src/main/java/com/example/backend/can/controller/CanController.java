package com.example.backend.can.controller;

import com.example.backend.audit.AuditLog;
import com.example.backend.can.dto.CanFrameResponse;
import com.example.backend.can.service.CanSessionService;
import com.example.backend.can.service.InfluxQueryService;
import com.example.backend.can.service.InfluxWriteService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.backend.can.dto.FrameCountResponse;
import com.example.backend.can.dto.PipelineStatsResponse;
import com.example.backend.can.dto.SessionFrameMetadataDto;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/can")
@RequiredArgsConstructor
public class CanController {

    private final CanSessionService canSessionService;
    private final InfluxWriteService influxWriteService;
    private final InfluxQueryService influxQueryService;

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
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

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/frames")
    public ResponseEntity<?> getFrames(
            @PathVariable String sessionId,
            @RequestParam(required = false) String msgId,
            @RequestParam(required = false) String bus,
            @RequestParam(defaultValue = "false") boolean faultsOnly,
            @RequestParam(defaultValue = "false") boolean anomalyOnly,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "500") int size) {

        if (anomalyOnly) {
            return ResponseEntity.status(org.springframework.http.HttpStatus.NOT_IMPLEMENTED)
                    .body(Map.of("message", "Anomaly detection not yet implemented"));
        }

        return ResponseEntity.ok(
            canSessionService.getFramesFiltered(sessionId, msgId, bus, faultsOnly, page, size));
    }

    /**
     * Frame count for a session — used by pagination UI to compute total pages.
     * GET /api/can/sessions/{sessionId}/frame-count
     */
    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/frame-count")
    public ResponseEntity<FrameCountResponse> getFrameCount(
            @PathVariable String sessionId) {
        long count = canSessionService.getFrameCount(sessionId);
        return ResponseEntity.ok(new FrameCountResponse(sessionId, count));
    }

    /**
     * Lightweight filter-option metadata — distinct msgIds, buses, messages, and signal names.
     * GET /api/can/sessions/{sessionId}/metadata
     */
    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/metadata")
    public ResponseEntity<SessionFrameMetadataDto> getSessionMetadata(
            @PathVariable String sessionId,
            @RequestParam(required = false) String bus,
            @RequestParam(required = false) String msgId) {
        return ResponseEntity.ok(canSessionService.getSessionFrameMetadata(sessionId, bus, msgId));
    }

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/pipeline-stats")
    public ResponseEntity<PipelineStatsResponse> getPipelineStats(
            @PathVariable String sessionId) {
        long mysqlFrames = canSessionService.getFrameCount(sessionId);
        long influxPoints = influxWriteService.countPoints(sessionId);
        return ResponseEntity.ok(new PipelineStatsResponse(sessionId, mysqlFrames, influxPoints));
    }

    /**
     * Export all frames for a session as CSV.
     * GET /api/can/sessions/{sessionId}/frames/export.csv
     */
    @PreAuthorize("hasAuthority('log:export') or hasRole('ADMIN')")
    @AuditLog(action = "LOG_EXPORT", resource = "sessions", resourceIdParam = "sessionId")
    @GetMapping("/sessions/{sessionId}/frames/export.csv")
    public ResponseEntity<String> exportFramesCsv(@PathVariable String sessionId) {
        List<CanFrameResponse> frames = canSessionService.getFramesBySession(sessionId);
        double sessionStartTs = canSessionService.getSessionStartTs(sessionId);

        // One InfluxDB round-trip for all signals in the session — keyed by absolute nanoseconds.
        // The key formula matches InfluxWriteService.writeFrame() exactly so frame rows align.
        Map<Long, Map<String, String>> signalMap =
                influxQueryService.queryFrameSignalsForExport(sessionId);

        StringBuilder csv = new StringBuilder();
        csv.append("id,sessionId,timestamp,channel,channelName,")
           .append("msgId,msgName,direction,rawBytes,signals\n");

        for (CanFrameResponse f : frames) {
            double frameTs = f.timestamp() != null ? f.timestamp() : 0.0;
            double absoluteTs = frameTs > 1_000_000_000.0 ? frameTs : sessionStartTs + frameTs;
            long nanos = (long)(absoluteTs * 1_000_000_000L);
            Map<String, String> signals = signalMap.getOrDefault(nanos, Map.of());

            csv.append(f.id() != null ? f.id() : "").append(',')
               .append(f.sessionId()).append(',')
               .append(f.timestamp()).append(',')
               .append(f.channel() != null ? f.channel() : "").append(',')
               .append(escapeCsv(f.channelName())).append(',')
               .append(escapeCsv(f.msgId())).append(',')
               .append(escapeCsv(f.msgName())).append(',')
               .append(escapeCsv(f.direction())).append(',')
               .append(escapeCsv(f.rawBytes())).append(',')
               .append(escapeCsv(buildSignalsString(signals))).append('\n');
        }

        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"session-" + sessionId + ".csv\"");
        headers.add(HttpHeaders.CONTENT_TYPE, "text/csv; charset=UTF-8");

        return ResponseEntity.ok().headers(headers).body(csv.toString());
    }

    private String buildSignalsString(Map<String, String> signals) {
        if (signals.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : signals.entrySet()) {
            if (sb.length() > 0) sb.append(';');
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    private String escapeCsv(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    @PreAuthorize("hasRole('ADMIN')")
    @AuditLog(action = "SESSION_DELETE", resource = "sessions", resourceIdParam = "sessionId")
    @DeleteMapping("/sessions/{sessionId}")
    public ResponseEntity<?> deleteSession(@PathVariable String sessionId) {
        return ResponseEntity.ok(canSessionService.deleteSession(sessionId));
    }
}
