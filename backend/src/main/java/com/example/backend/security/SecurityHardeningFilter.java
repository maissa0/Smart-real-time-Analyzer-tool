package com.example.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Adds essential security headers to all responses.
 */
@Component
public class SecurityHardeningFilter extends OncePerRequestFilter {

    private static final String X_CONTENT_TYPE_OPTIONS = "X-Content-Type-Options";
    private static final String NOSNIFF = "nosniff";
    private static final String STRICT_TRANSPORT_SECURITY = "Strict-Transport-Security";
    private static final String HSTS_VALUE = "max-age=31536000; includeSubDomains; preload";
    private static final String CONTENT_SECURITY_POLICY = "Content-Security-Policy";
    private static final String CSP_VALUE = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' ws://localhost:8080 wss://localhost:8080";
    private static final String X_FRAME_OPTIONS = "X-Frame-Options";
    private static final String DENY = "DENY";
    private static final String X_XSS_PROTECTION = "X-XSS-Protection";
    private static final String XSS_VALUE = "1; mode=block";

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {
        response.setHeader(X_CONTENT_TYPE_OPTIONS, NOSNIFF);
        response.setHeader(X_FRAME_OPTIONS, DENY);
        response.setHeader(X_XSS_PROTECTION, XSS_VALUE);
        response.setHeader(CONTENT_SECURITY_POLICY, CSP_VALUE);
        // HSTS - only add when using HTTPS in production
        if (request.isSecure()) {
            response.setHeader(STRICT_TRANSPORT_SECURITY, HSTS_VALUE);
        }
        filterChain.doFilter(request, response);
    }
}
