package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record SignalData(
        @JsonProperty("signal_name") String signalName,
        @JsonProperty("raw_value")   Object rawValue,
        @JsonProperty("label")       String label
) {}
