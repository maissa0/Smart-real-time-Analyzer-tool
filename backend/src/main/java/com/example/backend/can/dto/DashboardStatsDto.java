package com.example.backend.can.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Response DTO for GET /api/dashboard/stats.
 * All fields computed from live DB aggregations with 30-second cache TTL.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DashboardStatsDto {

    /** Total number of CAN sessions in the database. */
    private Long sessionCount;

    /** Sum of frame_count across all sessions. */
    private Long totalFrames;

    /** Number of sessions currently with status = 'live'. */
    private Long activeSessions;

    /** Total number of integrity faults detected across all sessions. */
    private Long totalFaults;

    /**
     * Breakdown of faults by type.
     * Keys: DUPLICATE, TIMING_GAP, SIGNAL_RANGE
     * Values: count of faults of that type
     */
    private Map<String, Long> faultsByType;

    /**
     * Top 5 message IDs by frame count.
     * Each entry: { "msgId": "0x123", "count": 45678 }
     */
    private List<TopMessageIdDto> topMessageIds;

    /** Total number of registered vehicles (cars). */
    private Long totalCars;
}
