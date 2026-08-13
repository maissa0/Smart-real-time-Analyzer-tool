package com.example.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;

/**
 * DIAGNOSTIC FILTER — REMOVE BEFORE PRODUCTION DEPLOYMENT.
 *
 * Runs at the absolute highest priority (Integer.MIN_VALUE) — before Spring
 * Security's filter chain, before CORS processing, before everything.
 * Logs every HTTP header the instant the request enters the JVM.
 *
 * Use this to answer one question:
 *   "Is the Authorization header present when the request arrives at the server?"
 *
 * If Authorization IS logged here but is absent in JwtAuthenticationFilter,
 *   a filter between this one and JwtAuthenticationFilter is stripping it.
 *
 * If Authorization is ABSENT here, the browser never sent it — the CORS
 *   preflight response did not allow it, or the Angular interceptor did not
 *   attach it for this particular request.
 *
 * HOW TO READ THE LOGS
 * ─────────────────────
 * Expected output for a correctly authenticated GET /api/cars:
 *
 *   [CORS-DBG] ─── GET /api/cars ───────────────────────────────────
 *   [CORS-DBG]   origin         : http://localhost:4200
 *   [CORS-DBG]   authorization  : ✅ Bearer eyJhbGci… (present)
 *   [CORS-DBG]   content-type   : application/json
 *   ...
 *   [CORS-DBG] ─── end headers ─────────────────────────────────────
 *
 * If you see "⚠ ABSENT" on the authorization line, the header was stripped
 * by the browser before the request reached the server.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@Slf4j
public class CorsDebugFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain
    ) throws ServletException, IOException {

        if (log.isDebugEnabled()) {
            String method = request.getMethod();
            String uri    = request.getRequestURI();

            log.debug("[CORS-DBG] ─── {} {} ──────────────────────────────────────", method, uri);

            Collections.list(request.getHeaderNames()).stream()
                    .sorted()
                    .forEach(name -> {
                        String value = request.getHeader(name);
                        if ("authorization".equalsIgnoreCase(name)) {
                            // Truncate token — log only first 30 chars to avoid leaking credentials
                            String display = value != null && value.length() > 30
                                    ? value.substring(0, 30) + "…"
                                    : value;
                            log.debug("[CORS-DBG]   {} : ✅ {} (present)", name, display);
                        } else {
                            log.debug("[CORS-DBG]   {} : {}", name, value);
                        }
                    });

            if (request.getHeader("Authorization") == null) {
                log.debug("[CORS-DBG]   authorization : ⚠ ABSENT — header was not received by the server");
            }

            log.debug("[CORS-DBG] ─── end headers ──────────────────────────────────");
        }

        chain.doFilter(request, response);
    }

    /**
     * Skip detailed logging for WebSocket transport paths — those generate
     * many requests and their headers are not relevant to the REST 401 issue.
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getRequestURI().startsWith("/ws-ecu-gateway");
    }
}
