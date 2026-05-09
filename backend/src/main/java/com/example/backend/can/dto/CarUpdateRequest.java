package com.example.backend.can.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for updating an existing car.
 * All fields are optional — only non-null fields are applied (PATCH semantics).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CarUpdateRequest {

    @Pattern(
        regexp = "^[A-HJ-NPR-Z0-9]{17}$",
        message = "VIN must be exactly 17 characters (A-H, J-N, P-R, Z, 0-9 — no I, O, or Q)"
    )
    private String vin;

    private String make;
    private String model;

    @Min(value = 1990, message = "Year must be 1990 or later")
    @Max(value = 2030, message = "Year must be 2030 or earlier")
    private Integer year;

    private String color;
    private Boolean isVirtual;
    private Boolean isActive;
}
