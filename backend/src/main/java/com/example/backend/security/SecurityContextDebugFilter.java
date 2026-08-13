package com.example.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.lang.NonNull;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * [TEMP-DEBUG] Positioned just before AnonymousAuthenticationFilter in the chain.
 *
 * This filter runs AFTER all custom security filters (SecurityHardeningFilter,
 * RateLimitFilter, JwtAuthenticationFilter, SessionHeartbeatFilter) and BEFORE
 * AnonymousAuthenticationFilter and AuthorizationFilter.
 *
 * It answers two questions:
 *   1. Is the SecurityContext still populated with the JWT-authenticated principal
 *      at this point in the chain? If yes, the 401 originates after this filter.
 *      If no, the context was cleared by one of the custom filters above.
 *   2. What DispatcherType is the request? An ERROR dispatch here means Spring Boot
 *      is re-running the security chain for an /error forward — which happens when
 *      a filter or service throws an unhandled exception and the SecurityContextHolder
 *      was already cleared by SecurityContextHolderFilter's finally block.
 *
 * Remove before production deployment.
 */
@Slf4j
public class SecurityContextDebugFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        DispatcherType dispatcherType = request.getDispatcherType();

        if (auth == null) {
            log.warn("[CTX-DEBUG] {} {} dispatchType={} — SecurityContext EMPTY — "
                    + "context was cleared before AnonymousAuthenticationFilter ran. "
                    + "Likely cause: SessionHeartbeatFilter threw an exception and "
                    + "SecurityContextHolderFilter.finally cleared the context, then "
                    + "Tomcat dispatched an ERROR forward to /error with no auth.",
                    request.getMethod(), request.getRequestURI(), dispatcherType);
        } else {
            log.warn("[CTX-DEBUG] {} {} dispatchType={} — principal={} type={} authenticated={} authorities={}",
                    request.getMethod(), request.getRequestURI(), dispatcherType,
                    auth.getName(),
                    auth.getClass().getSimpleName(),
                    auth.isAuthenticated(),
                    auth.getAuthorities());
        }

        // Log error-dispatch attributes so we can trace the original failing URI.
        if (dispatcherType == DispatcherType.ERROR) {
            Object originalUri  = request.getAttribute("jakarta.servlet.error.request_uri");
            Object errorStatus  = request.getAttribute("jakarta.servlet.error.status_code");
            Object errorMessage = request.getAttribute("jakarta.servlet.error.message");
            Throwable errorEx   = (Throwable) request.getAttribute("jakarta.servlet.error.exception");
            log.warn("[CTX-DEBUG] ERROR dispatch — originalUri={} errorStatus={} errorMessage={} exceptionClass={}",
                    originalUri, errorStatus, errorMessage,
                    errorEx != null ? errorEx.getClass().getSimpleName() : "none");
        }

        filterChain.doFilter(request, response);
    }

    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        // Skip WebSocket transport — those are authenticated at STOMP level.
        return request.getRequestURI().startsWith("/ws-ecu-gateway");
    }
}
