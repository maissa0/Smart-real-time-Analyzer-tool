package com.example.backend.can.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for creating a new car.
 * Validates input before it reaches the service layer.
 *
 * VIN validation: ISO 3779 standard — 17 alphanumeric chars
 * excluding I, O, Q to avoid confusion with 1, 0.
 * VIN is optional (null allowed) for virtual/simulator cars.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CarCreateRequest {

    /**
     * Vehicle Identification Number — optional for virtual cars.
     * When provided, must match ISO 3779: 17 chars, no I/O/Q.
     */
    @Pattern(
        regexp = "^[A-HJ-NPR-Z0-9]{17}$",
        message = "VIN must be exactly 17 characters (A-H, J-N, P-R, Z, 0-9 — no I, O, or Q)"
    )
    private String vin;

    /** Vehicle manufacturer name — required. */
    @NotBlank(message = "Make is required")
    private String make;

    /** Vehicle model name — required. */
    @NotBlank(message = "Model is required")
    private String model;

    /** Model year — must be between 1990 and 2030. */
    @Min(value = 1990, message = "Year must be 1990 or later")
    @Max(value = 2030, message = "Year must be 2030 or earlier")
    private Integer year;

    /** Optional color descriptor. */
    private String color;

    /**
     * If true, this car is a virtual simulator car.
     * Virtual cars may have a null VIN.
     * Defaults to false (physical car).
     */
    private Boolean isVirtual;
}
