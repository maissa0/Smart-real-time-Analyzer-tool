package com.molka.smart_analyzer_backend.service;

import com.molka.smart_analyzer_backend.dto.SessionResponse;
import com.molka.smart_analyzer_backend.entity.SessionEntity;
import com.molka.smart_analyzer_backend.repository.SessionRepository;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class SessionService {

    @Value("${jwt.expiration-ms}")
    private long expirationMs;

    private final SessionRepository sessionRepository;

    // ── Token hashing ──────────────────────────────────────────────────────────

    public String hashToken(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    // ── Create session on login ────────────────────────────────────────────────

    @Transactional
    public void createSession(Long userId, String rawToken, HttpServletRequest request) {
        String tokenHash = hashToken(rawToken);
        String ip        = extractIp(request);
        String ua        = truncate(request.getHeader("User-Agent"), 512);
        Instant now      = Instant.now();
        Instant expires  = now.plusMillis(expirationMs);

        // Upsert: if a session for this exact token already exists (e.g. re-login), skip
        if (sessionRepository.findByTokenHash(tokenHash).isPresent()) return;

        SessionEntity session = SessionEntity.builder()
                .userId(userId)
                .tokenHash(tokenHash)
                .ipAddress(ip)
                .userAgent(ua)
                .lastActiveAt(now)
                .expiresAt(expires)
                .revoked(false)
                .build();
        sessionRepository.save(session);
    }

    // ── Get active sessions ────────────────────────────────────────────────────

    @Transactional
    public List<SessionResponse> getSessions(Long userId, String rawToken) {
        String currentHash = hashToken(rawToken);
        Instant now = Instant.now();

        List<SessionEntity> sessions =
                sessionRepository.findByUserIdAndRevokedFalseAndExpiresAtAfterOrderByCreatedAtDesc(userId, now);

        return sessions.stream().map(s -> {
            boolean isCurrent = currentHash.equals(s.getTokenHash());
            if (isCurrent) {
                s.setLastActiveAt(now);
                sessionRepository.save(s);
            }
            return new SessionResponse(
                    s.getId(),
                    s.getIpAddress(),
                    s.getUserAgent(),
                    s.getCreatedAt(),
                    s.getLastActiveAt(),
                    s.getExpiresAt(),
                    isCurrent
            );
        }).toList();
    }

    // ── Revoke a specific session ──────────────────────────────────────────────

    @Transactional
    public void revokeSession(Long sessionId, Long userId) {
        SessionEntity session = sessionRepository.findByIdAndUserId(sessionId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found."));
        session.setRevoked(true);
        sessionRepository.save(session);
    }

    // ── Revoke all sessions except the current one ────────────────────────────

    @Transactional
    public int revokeAllOtherSessions(Long userId, String rawToken) {
        String currentHash = hashToken(rawToken);
        return sessionRepository.revokeAllExcept(userId, currentHash);
    }

    // ── Scheduled cleanup ─────────────────────────────────────────────────────

    @Scheduled(cron = "0 0 * * * *") // Every hour
    @Transactional
    public void cleanupExpiredSessions() {
        sessionRepository.deleteByExpiresAtBefore(Instant.now());
        log.debug("Expired sessions cleaned up.");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String extractIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private String truncate(String value, int max) {
        if (value == null) return null;
        return value.length() > max ? value.substring(0, max) : value;
    }
}
