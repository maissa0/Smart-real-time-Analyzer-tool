package com.molka.smart_analyzer_backend.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateMeRequest(
		@NotBlank @Size(min = 3, max = 64) String username,
		@NotBlank @Email String email,
		String currentPassword,                         // required when newPassword is set
		@Size(min = 6, max = 128) String newPassword   // null / blank = keep current
) {}
