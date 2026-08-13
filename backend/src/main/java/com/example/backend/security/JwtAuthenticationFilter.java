package com.example.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
@RequiredArgsConstructor
@Slf4j
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final UserDetailsService userDetailsService;

    /**
     * Bypasses JWT processing entirely for WebSocket transport requests.
     * SockJS sends HTTP requests to /ws-ecu-gateway/** (info negotiation,
     * XHR polling, WebSocket upgrade) — these are permitted by SecurityConfig
     * and authenticated at the STOMP protocol level by WebSocketConfig's
     * ChannelInterceptor, not by the HTTP filter chain.
     * Skipping here prevents spurious "no Bearer token" debug noise and
     * ensures the upgrade handshake is never accidentally blocked.
     */
    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        String path = request.getRequestURI();
        boolean isWebSocket = path.startsWith("/ws-ecu-gateway");
        if (isWebSocket) {
            log.debug("JWT filter: bypassing {} — WebSocket auth handled by STOMP ChannelInterceptor", path);
        }
        return isWebSocket;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {
        try {
            String jwt = extractJwtFromRequest(request);

            if (!StringUtils.hasText(jwt)) {
                log.debug("JWT filter: no Bearer token on {} {}", request.getMethod(), request.getRequestURI());
                filterChain.doFilter(request, response);
                return;
            }

            if (!jwtService.isTokenValid(jwt)) {
                log.debug("JWT filter: token invalid or expired on {} {}", request.getMethod(), request.getRequestURI());
                filterChain.doFilter(request, response);
                return;
            }

            // MFA_AUTH tokens are single-use for /mfa/verify only — reject as a Bearer token
            if (jwtService.isMfaAuthToken(jwt)) {
                log.debug("JWT filter: MFA auth token rejected as Bearer on {}", request.getRequestURI());
                filterChain.doFilter(request, response);
                return;
            }

            String email = jwtService.getEmailFromToken(jwt);
            if (email != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                UserDetails userDetails = userDetailsService.loadUserByUsername(email);
                UsernamePasswordAuthenticationToken authToken =
                        new UsernamePasswordAuthenticationToken(
                                userDetails, null, userDetails.getAuthorities());
                authToken.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(authToken);
                log.debug("JWT filter: authenticated user={} authorities={} on {} {}",
                        email, userDetails.getAuthorities(), request.getMethod(), request.getRequestURI());
            }

        } catch (Exception e) {
            log.warn("JWT filter exception on {} {}: {} — {}",
                    request.getMethod(), request.getRequestURI(),
                    e.getClass().getSimpleName(), e.getMessage());
        }

        filterChain.doFilter(request, response);
    }

    private String extractJwtFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader(AUTHORIZATION_HEADER);
        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith(BEARER_PREFIX)) {
            return bearerToken.substring(BEARER_PREFIX.length());
        }
        // CSV export is triggered via direct browser navigation (<a href> download), which
        // cannot set an Authorization header — accept the token as a query param, scoped to
        // that single path only, so it is still validated by @PreAuthorize downstream.
        if (request.getRequestURI().endsWith("/export.csv")) {
            String queryToken = request.getParameter("token");
            if (StringUtils.hasText(queryToken)) {
                return queryToken;
            }
        }
        return null;
    }
}
