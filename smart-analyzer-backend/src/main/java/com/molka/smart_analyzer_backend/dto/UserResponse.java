package com.molka.smart_analyzer_backend.dto;

import com.molka.smart_analyzer_backend.entity.Role;

import java.time.Instant;

public record UserResponse(Long id, String username, String email, Role role, Instant createdAt, String avatarUrl) {
}
