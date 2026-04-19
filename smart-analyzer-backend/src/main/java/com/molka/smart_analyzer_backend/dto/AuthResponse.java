package com.molka.smart_analyzer_backend.dto;

public record AuthResponse(String accessToken, String tokenType,
		Long userId, String username, String email, String role) {

	public AuthResponse(String accessToken, Long userId, String username, String email, String role) {
		this(accessToken, "Bearer", userId, username, email, role);
	}
}
