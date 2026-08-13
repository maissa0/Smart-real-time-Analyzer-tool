package com.example.backend.can.dto;

public record SimulatorEntryDto(
        String simId,
        boolean running,
        long pid,
        String startedAt,
        String mode,
        Integer framesProduced
) {}
