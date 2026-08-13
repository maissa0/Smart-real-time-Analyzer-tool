package com.example.backend.can.dto;

public record SimulatorStartRequest(
        String mode,
        String logFile,
        Double speed,
        Boolean loop,
        Boolean injectValueErrors,
        Boolean injectTimingGaps,
        Boolean injectCounterErrors,
        Boolean injectDuplicates,
        Double faultRate,
        String carUid
) {}
