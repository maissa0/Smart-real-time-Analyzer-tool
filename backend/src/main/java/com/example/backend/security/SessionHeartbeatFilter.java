package com.example.backend.security;

import com.example.backend.repository.SessionRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.lang.NonNull;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.UUID;

/**
 * Updates last_active timestamp for the current session on every authenticated request.
 * Ensures the Active Sessions list shows real-time activity.
 */
@Component
@RequiredArgsConstructor
public class SessionHeartbeatFilter extends OncePerRequestFilter {

    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final SessionRepository sessionRepository;

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {
        // Update session last_active for authenticated requests (runs after JwtAuthenticationFilter)
        if (SecurityContextHolder.getContext().getAuthentication() != null
                && SecurityContextHolder.getContext().getAuthentication().isAuthenticated()) {
            String jwt = extractJwt(request);
            if (StringUtils.hasText(jwt) && jwtService.isTokenValid(jwt)) {
                UUID sessionId = jwtService.getSessionIdFromToken(jwt);
                if (sessionId != null) {
                    sessionRepository.findById(sessionId).ifPresent(session -> {
                        session.setLastActive(Instant.now());
                        sessionRepository.save(session);
                    });
                }
            }
        }
        filterChain.doFilter(request, response);
    }

    private String extractJwt(HttpServletRequest request) {
        String bearer = request.getHeader(AUTHORIZATION_HEADER);
        if (StringUtils.hasText(bearer) && bearer.startsWith(BEARER_PREFIX)) {
            return bearer.substring(BEARER_PREFIX.length());
        }
        return null;
    }
}
