package com.example.backend.can.dto;

/** One ECU catalog assigned (or assignable) to a car. */
public record CarCatalogDto(
        String filename,
        String name,
        String busName
) {}
