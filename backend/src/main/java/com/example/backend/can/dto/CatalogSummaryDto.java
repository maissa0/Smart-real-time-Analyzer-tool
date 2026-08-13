package com.example.backend.can.dto;

public record CatalogSummaryDto(
        String filename,
        String busName,
        int messageCount,
        int signalCount,
        long fileSize,
        String lastModified
) {}
