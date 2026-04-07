package com.molka.smart_analyzer_backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record FrameRequest(
		@NotNull Double timestamp,
		@NotBlank String address,
		@NotBlank String bus,
		@NotBlank String message,
		@NotBlank String direction,
		@NotBlank String rawData,
		@NotBlank String signals
) {
}

