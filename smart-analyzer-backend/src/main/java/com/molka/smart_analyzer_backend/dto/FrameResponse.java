package com.molka.smart_analyzer_backend.dto;

import java.time.Instant;

public record FrameResponse(
		Long id,
		Double timestamp,
		String address,
		String bus,
		String message,
		String direction,
		String rawData,
		String signals,
		Instant createdAt
) {
}

