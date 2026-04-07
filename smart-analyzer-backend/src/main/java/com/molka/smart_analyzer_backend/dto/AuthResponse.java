package com.molka.smart_analyzer_backend.dto;

public record AuthResponse(String accessToken, String tokenType) {
	public AuthResponse(String accessToken) {
		this(accessToken, "Bearer");
	}
}
