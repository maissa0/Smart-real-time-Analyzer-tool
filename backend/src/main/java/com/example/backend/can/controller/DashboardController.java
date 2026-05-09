package com.example.backend.can.controller;

import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.dto.DashboardStatsDto;
import com.example.backend.can.repository.CanFrameRepository;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.service.CanSessionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * REST controller for dashboard statistics.
 * Endpoints are cached with a 30-second TTL to avoid full table scans
 * on every dashboard page load (371,854 frames × multiple queries).
 *
 * Base path: /api/dashboard
 */
@RestController
@RequestMapping("/api/dashboard")
@RequiredArgsConstructor
@Slf4j
public class DashboardController {

    private final CanSessionRepository canSessionRepository;
    private final CanFrameRepository canFrameRepository;
    private final IntegrityFaultRepository integrityFaultRepository;
    private final CarRepository carRepository;
    private final CanSessionService canSessionService;

    // ── GET /api/dashboard/stats ──────────────────────────────────────────────

    /**
     * Returns aggregated dashboard statistics.
     * Cached for 30 seconds — first call hits DB, subsequent calls return cache.
     *
     * Aggregations:
     * - Session count + total frames + active sessions (one JPQL query)
     * - Total faults + faults by type (one JPQL query)
     * - Top 5 message IDs by frame count (one JPQL query)
     * - Total cars (one COUNT query)
     */
    @GetMapping("/stats")
    @Cacheable("dashboard-stats")
    public ResponseEntity<DashboardStatsDto> getStats() {
        log.info("Computing dashboard stats (cache miss)");

        // ── Session aggregates ────────────────────────────────────────────────
        long sessionCount = 0L;
        long totalFrames  = 0L;
        long activeSessions = 0L;

        List<Object[]> sessionStats = canSessionRepository.getDashboardSessionStats();
        if (sessionStats != null && !sessionStats.isEmpty() && sessionStats.get(0) != null) {
            Object[] row = sessionStats.get(0);
            if (row[0] != null) sessionCount    = ((Number) row[0]).longValue();
            if (row[1] != null) totalFrames     = ((Number) row[1]).longValue();
            if (row[2] != null) activeSessions  = ((Number) row[2]).longValue();
        }

        // ── Fault aggregates ──────────────────────────────────────────────────
        long totalFaults = integrityFaultRepository.count();
        Map<String, Long> faultsByType = new LinkedHashMap<>();
        List<Object[]> faultRows = integrityFaultRepository.countByFaultType();
        for (Object[] row : faultRows) {
            String type  = row[0] != null ? row[0].toString() : "UNKNOWN";
            long   count = row[1] != null ? ((Number) row[1]).longValue() : 0L;
            faultsByType.put(type, count);
        }

        // ── Top 5 message IDs ─────────────────────────────────────────────────
        List<Map<String, Object>> topMsgIds = new ArrayList<>();
        List<Object[]> msgRows = canFrameRepository.findTopMsgIds(PageRequest.of(0, 5));
        for (Object[] row : msgRows) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("msgId", row[0] != null ? row[0].toString() : "unknown");
            entry.put("count", row[1] != null ? ((Number) row[1]).longValue() : 0L);
            topMsgIds.add(entry);
        }

        // ── Cars count ────────────────────────────────────────────────────────
        long totalCars = carRepository.countByIsActiveTrueAndDeletedAtIsNull();

        DashboardStatsDto dto = DashboardStatsDto.builder()
                .sessionCount(sessionCount)
                .totalFrames(totalFrames)
                .activeSessions(activeSessions)
                .totalFaults(totalFaults)
                .faultsByType(faultsByType)
                .topMessageIds(topMsgIds)
                .totalCars(totalCars)
                .build();

        return ResponseEntity.ok(dto);
    }

    // ── GET /api/dashboard/recent-sessions ────────────────────────────────────

    /**
     * Returns the N most recent sessions (default 5).
     * Not cached — callers expect fresh data for the recent sessions widget.
     *
     * @param size number of sessions to return (default 5, max 20)
     */
    @GetMapping("/recent-sessions")
    public ResponseEntity<List<CanSessionResponse>> getRecentSessions(
            @RequestParam(defaultValue = "5") int size) {
        if (size > 20) size = 20;
        List<CanSessionResponse> sessions = canSessionService
                .getAllSessions()
                .stream()
                .limit(size)
                .toList();
        return ResponseEntity.ok(sessions);
    }
}
