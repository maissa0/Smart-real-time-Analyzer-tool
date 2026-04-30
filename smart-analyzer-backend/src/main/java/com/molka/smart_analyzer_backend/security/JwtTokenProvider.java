package com.molka.smart_analyzer_backend.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.util.Date;
import java.util.function.Function;

@Component
public class JwtTokenProvider {

	private final SecretKey signingKey;
	private final long expirationMs;

	public JwtTokenProvider(
			@Value("${jwt.secret}") String secret,
			@Value("${jwt.expiration-ms}") long expirationMs) {
		byte[] keyBytes = secret.getBytes(java.nio.charset.StandardCharsets.UTF_8);
		this.signingKey = Keys.hmacShaKeyFor(keyBytes);
		this.expirationMs = expirationMs;
	}

	public String generateToken(UserDetails userDetails) {
		Date now = new Date();
		Date expiry = new Date(now.getTime() + expirationMs);
		return Jwts.builder()
				.subject(userDetails.getUsername())
				.issuedAt(now)
				.expiration(expiry)
				.signWith(signingKey)
				.compact();
	}

	/** Short-lived (5 min) token that carries an mfa_pending claim. */
	public String generateMfaToken(String username) {
		Date now = new Date();
		Date expiry = new Date(now.getTime() + 5 * 60 * 1000L);
		return Jwts.builder()
				.subject(username)
				.claim("mfa_pending", true)
				.issuedAt(now)
				.expiration(expiry)
				.signWith(signingKey)
				.compact();
	}

	/** Returns true if the token is a valid, unexpired MFA-pending token. */
	public boolean isMfaPendingToken(String token) {
		try {
			Claims claims = Jwts.parser()
					.verifyWith(signingKey)
					.build()
					.parseSignedClaims(token)
					.getPayload();
			Boolean mfaPending = claims.get("mfa_pending", Boolean.class);
			return Boolean.TRUE.equals(mfaPending) && !claims.getExpiration().before(new Date());
		} catch (Exception e) {
			return false;
		}
	}

	public String getUsernameFromToken(String token) {
		return getClaim(token, Claims::getSubject);
	}

	public boolean isTokenValid(String token, UserDetails userDetails) {
		try {
			Claims claims = Jwts.parser()
					.verifyWith(signingKey)
					.build()
					.parseSignedClaims(token)
					.getPayload();
			// Reject MFA-pending tokens — they must not authenticate regular requests
			if (Boolean.TRUE.equals(claims.get("mfa_pending", Boolean.class))) {
				return false;
			}
			String username = claims.getSubject();
			return username.equals(userDetails.getUsername()) && !claims.getExpiration().before(new Date());
		} catch (Exception e) {
			return false;
		}
	}

	private boolean isTokenExpired(String token) {
		return getClaim(token, Claims::getExpiration).before(new Date());
	}

	private <T> T getClaim(String token, Function<Claims, T> claimsResolver) {
		Claims claims = Jwts.parser()
				.verifyWith(signingKey)
				.build()
				.parseSignedClaims(token)
				.getPayload();
		return claimsResolver.apply(claims);
	}
}
