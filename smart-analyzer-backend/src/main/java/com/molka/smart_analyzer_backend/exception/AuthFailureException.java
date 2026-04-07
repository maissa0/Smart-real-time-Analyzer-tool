package com.molka.smart_analyzer_backend.exception;

public class AuthFailureException extends RuntimeException {
	public AuthFailureException(String message) {
		super(message);
	}
}

