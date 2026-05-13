package com.example.backend.dto.v1;

import jakarta.validation.constraints.Size;

/**
 * Request DTO for updating user profile (fullName, phone, bio).
 */
public record UserProfileUpdateRequest(
        @Size(max = 255) String fullName,
        @Size(max = 100) String jobTitle,
        @Size(max = 100) String department,
        @Size(max = 50) String phone,
        @Size(max = 2000) String bio
) {
}
