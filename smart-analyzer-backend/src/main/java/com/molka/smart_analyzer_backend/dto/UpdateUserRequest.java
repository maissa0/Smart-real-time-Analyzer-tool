package com.molka.smart_analyzer_backend.dto;

import com.molka.smart_analyzer_backend.entity.Role;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateUserRequest(
		@NotBlank @Size(min = 3, max = 64) String username,
		@NotBlank @Email String email,
		Role role
) {}
