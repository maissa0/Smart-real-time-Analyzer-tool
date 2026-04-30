package com.molka.smart_analyzer_backend.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record ForgotPasswordRequest(
        @NotBlank @Email String email
) {}
