package com.example.backend.service;

import com.example.backend.dto.v1.SessionResponse;
import com.example.backend.entity.RefreshTokenEntity;
import com.example.backend.entity.SessionEntity;
import com.example.backend.repository.RefreshTokenRepository;
import com.example.backend.repository.SessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SessionService {

    private final SessionRepository sessionRepository;
    private final RefreshTokenRepository refreshTokenRepository;

    public List<SessionResponse> getSessionsForUser(UUID userId) {
        return sessionRepository.findByUserIdOrderByLastActiveDesc(userId).stream()
                .map(this::toResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void revokeSession(UUID sessionId, UUID currentUserId, boolean isAdmin) {
        SessionEntity session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found"));
        boolean isOwnSession = session.getUserId().equals(currentUserId);
        if (!isOwnSession && !isAdmin) {
            throw new IllegalArgumentException("Cannot revoke another user's session");
        }
        // Revoke all refresh tokens for this session
        List<RefreshTokenEntity> tokens = refreshTokenRepository.findBySessionId(sessionId);
        Instant now = Instant.now();
        for (RefreshTokenEntity t : tokens) {
            t.setRevokedAt(now);
        }
        refreshTokenRepository.saveAll(tokens);
        sessionRepository.delete(session);
    }

    private SessionResponse toResponse(SessionEntity s) {
        return new SessionResponse(
                s.getId().toString(),
                s.getDevice(),
                s.getIpAddress(),
                s.getUserAgent(),
                s.getLastActive(),
                s.getCreatedAt()
        );
    }
}
