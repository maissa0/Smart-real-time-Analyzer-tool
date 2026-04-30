package com.molka.smart_analyzer_backend.dto;

import java.time.Instant;

public record UploadResponse(Long id, String originalFilename, Instant uploadedAt, Integer frameCount) {
}
