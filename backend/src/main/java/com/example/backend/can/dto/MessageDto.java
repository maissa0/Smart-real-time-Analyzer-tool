package com.example.backend.can.dto;

import java.util.List;

public record MessageDto(String id, String name, Long cycleMs, List<SignalDto> signals) {}
