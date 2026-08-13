package com.example.backend.can.service;

import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.dto.DashboardStatsDto;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import com.example.backend.can.dto.TopMessageIdDto;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class DashboardService {

    private final CanSessionRepository canSessionRepository;
    private final InfluxQueryService influxQueryService;
    private final IntegrityFaultRepository integrityFaultRepository;
    private final CarRepository carRepository;
    private final CanSessionService canSessionService;

    /**
     * Aggregates all dashboard statistics in four DB queries.
     * Cached for 30 seconds to avoid full table scans on every page load.
     */
    @Cacheable("dashboard-stats")
    public DashboardStatsDto getStats() {
        log.info("Computing dashboard stats (cache miss)");

        // ── Session aggregates ────────────────────────────────────────────────
        long sessionCount   = 0L;
        long totalFrames    = 0L;
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
        for (Object[] row : integrityFaultRepository.countByFaultType()) {
            String type  = row[0] != null ? row[0].toString() : "UNKNOWN";
            long   count = row[1] != null ? ((Number) row[1]).longValue() : 0L;
            faultsByType.put(type, count);
        }

        // ── Top 5 message IDs (last 30 days, from InfluxDB can_frames) ─────────
        List<TopMessageIdDto> topMsgIds = influxQueryService.queryTopMsgIds(5);

        // ── Cars count ────────────────────────────────────────────────────────
        long totalCars = carRepository.countByIsActiveTrueAndDeletedAtIsNull();

        return DashboardStatsDto.builder()
                .sessionCount(sessionCount)
                .totalFrames(totalFrames)
                .activeSessions(activeSessions)
                .totalFaults(totalFaults)
                .faultsByType(faultsByType)
                .topMessageIds(topMsgIds)
                .totalCars(totalCars)
                .build();
    }

    public List<CanSessionResponse> getRecentSessions(int size) {
        return canSessionService.getAllSessions()
                .stream()
                .limit(size)
                .toList();
    }
}
