package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Response DTO for CarEntity.
 * Protects the entity from direct API exposure.
 * Computed fields (sessionCount, totalFrames, faultRate) are populated
 * by CarService and default to null when not requested.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CarDto {

    /** Public UUID — used as the external identifier in REST API paths. */
    private String carUid;

    /** Vehicle Identification Number — null for virtual/simulator cars. */
    private String vin;

    private String make;
    private String model;

    /** Model year (e.g. 2024). */
    private Integer year;

    private String color;

    /** Is this a virtual car (simulator only, no physical VIN)? */
    private Boolean isVirtual;

    /** Is this car currently active (accepting new sessions)? */
    private Boolean isActive;

    /** Timestamp when this car was registered in the system. */
    private LocalDateTime createdAt;

    // ── Computed fields — populated by CarService, null if not requested ──

    /** Number of CAN sessions associated with this car. */
    private Integer sessionCount;

    /** Timestamp of the most recent session for this car. */
    private LocalDateTime lastSessionAt;

    /** Total number of CAN frames across all sessions for this car. */
    private Long totalFrames;

    /**
     * Fault rate as a percentage of frames that triggered integrity faults.
     * Formula: (total faults / total frames) * 100.0
     * Null if no frames exist.
     */
    private Double faultRate;
}
