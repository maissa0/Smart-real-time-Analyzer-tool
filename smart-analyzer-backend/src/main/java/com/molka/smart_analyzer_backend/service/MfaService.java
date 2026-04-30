package com.molka.smart_analyzer_backend.service;

import com.warrenstrange.googleauth.GoogleAuthenticator;
import com.warrenstrange.googleauth.GoogleAuthenticatorKey;
import org.springframework.stereotype.Service;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@Service
public class MfaService {

	private static final String ISSUER = "SmartAnalyzer";
	private final GoogleAuthenticator gAuth = new GoogleAuthenticator();

	public String generateSecret() {
		GoogleAuthenticatorKey key = gAuth.createCredentials();
		return key.getKey();
	}

	public boolean verifyCode(String secret, int code) {
		return gAuth.authorize(secret, code);
	}

	public String buildQrCodeUrl(String userLabel, String secret) {
		String label = URLEncoder.encode(ISSUER + ":" + userLabel, StandardCharsets.UTF_8);
		String issuerEnc = URLEncoder.encode(ISSUER, StandardCharsets.UTF_8);
		return "otpauth://totp/" + label
				+ "?secret=" + secret
				+ "&issuer=" + issuerEnc;
	}
}
