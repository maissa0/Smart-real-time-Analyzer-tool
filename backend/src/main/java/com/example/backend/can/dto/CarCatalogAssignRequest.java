package com.example.backend.can.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * Replaces a car's assigned catalog set with the given filenames.
 * An empty list clears the assignment (car falls back to "all catalogs").
 */
public record CarCatalogAssignRequest(
        @NotNull List<String> filenames
) {}
