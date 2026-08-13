package com.example.backend.dto.v1;

import com.example.backend.validation.PasswordPolicy;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request DTO for password change.
 */
public record PasswordChangeRequest(
        @NotBlank(message = "Current password is required") String currentPassword,
        @NotBlank(message = "New password is required")
        @Size(min = 8, message = "New password must be at least 8 characters")
        @Pattern(regexp = PasswordPolicy.PATTERN, message = PasswordPolicy.MESSAGE) String newPassword
) {
}
