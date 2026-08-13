package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * One signal reading captured as operating-context for a fault: the raw value plus
 * (when the catalogue decodes it) a human-readable label. Serialized as an array into
 * {@code integrity_faults.context_json} and returned inside the enriched fault DTO.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record FaultContextSignal(
        String name,
        Object value,
        String label
) {}
