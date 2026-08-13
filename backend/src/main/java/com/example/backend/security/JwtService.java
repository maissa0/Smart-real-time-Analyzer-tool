package com.example.backend.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

@Service
public class JwtService {

    @Value("${app.jwt.secret}")
    private String secret;

    @Value("${app.jwt.access-token-expiration-ms:900000}") // 15 min
    private long accessTokenExpirationMs;

    @Value("${app.jwt.refresh-token-expiration-ms:604800000}") // 7 days
    private long refreshTokenExpirationMs;

    @Value("${app.jwt.reset-token-expiration-ms:900000}") // 15 min
    private long resetTokenExpirationMs;

    @Value("${app.jwt.mfa-auth-token-expiration-ms:300000}") // 5 min
    private long mfaAuthTokenExpirationMs;

    private SecretKey getSigningKey() {
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public String generateAccessToken(String email, UUID userId) {
        return generateAccessToken(email, userId, null);
    }

    public String generateAccessToken(String email, UUID userId, UUID sessionId) {
        var builder = Jwts.builder()
                .subject(email)
                .claim("userId", userId.toString())
                .claim("type", "access")
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + accessTokenExpirationMs))
                .signWith(getSigningKey());
        if (sessionId != null) {
            builder.claim("sessionId", sessionId.toString());
        }
        return builder.compact();
    }

    public String generateMfaAuthToken(String email, UUID userId) {
        return Jwts.builder()
                .subject(email)
                .claim("userId", userId.toString())
                .claim("type", "mfa_auth")
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + mfaAuthTokenExpirationMs))
                .signWith(getSigningKey())
                .compact();
    }

    public String generateRefreshToken(String email, UUID userId) {
        return Jwts.builder()
                .subject(email)
                .claim("userId", userId.toString())
                .claim("type", "refresh")
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + refreshTokenExpirationMs))
                .signWith(getSigningKey())
                .compact();
    }

    public String generateResetToken(String email, UUID userId) {
        return Jwts.builder()
                .subject(email)
                .claim("userId", userId.toString())
                .claim("type", "reset")
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + resetTokenExpirationMs))
                .signWith(getSigningKey())
                .compact();
    }

    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean isTokenValid(String token) {
        try {
            parseToken(token);
            return true;
        } catch (ExpiredJwtException e) {
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    public String getEmailFromToken(String token) {
        return parseToken(token).getSubject();
    }

    public UUID getUserIdFromToken(String token) {
        String userId = parseToken(token).get("userId", String.class);
        return userId != null ? UUID.fromString(userId) : null;
    }

    public long getAccessTokenExpirationSeconds() {
        return accessTokenExpirationMs / 1000;
    }

    public long getResetTokenExpirationSeconds() {
        return resetTokenExpirationMs / 1000;
    }

    public boolean isResetToken(String token) {
        try {
            String type = parseToken(token).get("type", String.class);
            return "reset".equals(type);
        } catch (Exception e) {
            return false;
        }
    }

    public boolean isMfaAuthToken(String token) {
        try {
            String type = parseToken(token).get("type", String.class);
            return "mfa_auth".equals(type);
        } catch (Exception e) {
            return false;
        }
    }

    public UUID getSessionIdFromToken(String token) {
        try {
            String sessionId = parseToken(token).get("sessionId", String.class);
            return sessionId != null ? UUID.fromString(sessionId) : null;
        } catch (Exception e) {
            return null;
        }
    }
}
