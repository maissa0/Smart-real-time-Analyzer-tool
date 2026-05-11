package com.example.backend.dto.v1;

public record StatusUpdateRequest(
        /** Optional reason for deactivation — shown in audit log */
        String reason
) {}
