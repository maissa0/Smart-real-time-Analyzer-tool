package com.example.backend.can.dto;

import java.util.Map;
import java.util.Set;

public record CatalogInfoDto(
        Map<String, Map<String, Set<Integer>>> signalValidValues,
        Map<String, Long> messageCycleTimes
) {}
