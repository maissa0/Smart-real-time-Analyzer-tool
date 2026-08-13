package com.example.backend.can.dto;

import java.util.List;
import java.util.Map;

public record NlQueryResponse(
        String queryType,
        String generatedQuery,
        String explanation,
        List<Map<String, Object>> results,
        int rowCount,
        long executionMs
) {}
