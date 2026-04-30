package com.molka.smart_analyzer_backend.simulator;

public record FaultPayload(boolean valueErrors, boolean timingGaps, boolean counterErrors) {}
