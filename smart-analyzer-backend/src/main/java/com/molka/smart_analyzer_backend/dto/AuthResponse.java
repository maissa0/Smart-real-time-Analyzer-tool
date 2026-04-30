package com.molka.smart_analyzer_backend.dto;

public record AuthResponse(String accessToken, String tokenType,
		Long userId, String username, String email, String role,
		Boolean mfaRequired, String mfaToken) {

	/** Normal successful login. */
	public AuthResponse(String accessToken, Long userId, String username, String email, String role) {
		this(accessToken, "Bearer", userId, username, email, role, null, null);
	}

	/** MFA challenge — credentials verified, TOTP still required. */
	public static AuthResponse mfaChallenge(String mfaToken) {
		return new AuthResponse(null, null, null, null, null, null, true, mfaToken);
	}
}
