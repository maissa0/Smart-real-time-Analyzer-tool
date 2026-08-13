package com.example.backend.can.dto;

import java.util.List;

public record SimulatorStatusResult(
        List<SimulatorEntryDto> simulators,
        int count,
        boolean running,
        Long pid,
        String startedAt,
        String mode,
        String simId
) {}
