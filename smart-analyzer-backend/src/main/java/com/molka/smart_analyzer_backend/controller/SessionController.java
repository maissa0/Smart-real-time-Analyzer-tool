package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.dto.SessionResponse;
import com.molka.smart_analyzer_backend.repository.UserRepository;
import com.molka.smart_analyzer_backend.service.AuditLogService;
import com.molka.smart_analyzer_backend.service.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private static final String BEARER_PREFIX = "Bearer ";

    private final SessionService  sessionService;
    private final UserRepository  userRepository;
    private final AuditLogService auditLogService;

    public SessionController(SessionService sessionService, UserRepository userRepository,
            AuditLogService auditLogService) {
        this.sessionService  = sessionService;
        this.userRepository  = userRepository;
        this.auditLogService = auditLogService;
    }

    /** Returns all active non-revoked sessions for the current user. */
    @GetMapping
    public ResponseEntity<List<SessionResponse>> getSessions(
            Authentication auth, HttpServletRequest request) {
        Long userId = resolveUserId(auth);
        String token = extractToken(request);
        return ResponseEntity.ok(sessionService.getSessions(userId, token));
    }

    /** Revokes a specific session. */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> revokeSession(
            @PathVariable Long id, Authentication auth, HttpServletRequest request) {
        try {
            Long userId = resolveUserId(auth);
            sessionService.revokeSession(id, userId);
            auditLogService.log(userId, auth.getName(), "SESSION_REVOKED", "SESSION",
                    String.valueOf(id), null, request);
            return ResponseEntity.ok(Map.of("message", "Session revoked."));
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
        }
    }

    /** Revokes all sessions except the one making this request. */
    @DeleteMapping("/others")
    public ResponseEntity<?> revokeOtherSessions(
            Authentication auth, HttpServletRequest request) {
        Long userId = resolveUserId(auth);
        int count = sessionService.revokeAllOtherSessions(userId, extractToken(request));
        auditLogService.log(userId, auth.getName(), "SESSIONS_REVOKED_ALL", "SESSION",
                null, "{\"count\":" + count + "}", request);
        return ResponseEntity.ok(Map.of("message", count + " other session(s) revoked."));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Long resolveUserId(Authentication auth) {
        return userRepository.findByUsername(auth.getName())
                .orElseThrow(() -> new IllegalStateException("Authenticated user not found"))
                .getId();
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            return header.substring(BEARER_PREFIX.length()).trim();
        }
        return "";
    }
}
