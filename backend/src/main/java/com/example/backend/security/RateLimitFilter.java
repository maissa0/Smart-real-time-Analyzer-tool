package com.example.backend.security;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.Refill;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Rate limits sensitive auth endpoints (login, forgot-password, verify-otp, mfa/verify)
 * at 5 attempts/minute/IP, and the LLM-backed NL-query endpoint at a separate, more
 * generous 20 requests/minute/IP — bucketed independently per category so a user
 * exercising one endpoint never exhausts the other's quota.
 */
@Component
@Slf4j
public class RateLimitFilter extends OncePerRequestFilter {

    private static final int AUTH_CAPACITY = 5;
    private static final int NL_QUERY_CAPACITY = 20;
    private static final Duration REFILL_DURATION = Duration.ofMinutes(1);

    private static final String[] AUTH_RATE_LIMITED_PATHS = {
            "/api/auth/login",
            "/api/auth/forgot-password",
            "/api/auth/verify-otp",
            "/api/auth/mfa/verify"
    };
    private static final String[] NL_QUERY_RATE_LIMITED_PATHS = {
            "/api/nl-query"
    };

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final ClientIpResolver clientIpResolver;

    public RateLimitFilter(ClientIpResolver clientIpResolver) {
        this.clientIpResolver = clientIpResolver;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {
        RateLimitCategory category = categorize(request.getRequestURI());
        if (category == null) {
            filterChain.doFilter(request, response);
            return;
        }

        String clientIp = clientIpResolver.resolve(request);
        String bucketKey = category.name() + "|" + clientIp;
        Bucket bucket = buckets.computeIfAbsent(bucketKey, k -> createBucket(category));

        if (bucket.tryConsume(1)) {
            filterChain.doFilter(request, response);
        } else {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Too many requests. Please try again later.\"}");
        }
    }

    private RateLimitCategory categorize(String uri) {
        if (uri == null) {
            return null;
        }
        for (String path : AUTH_RATE_LIMITED_PATHS) {
            if (uri.startsWith(path)) {
                return RateLimitCategory.AUTH;
            }
        }
        for (String path : NL_QUERY_RATE_LIMITED_PATHS) {
            if (uri.startsWith(path)) {
                return RateLimitCategory.NL_QUERY;
            }
        }
        return null;
    }

    private Bucket createBucket(RateLimitCategory category) {
        int capacity = category == RateLimitCategory.NL_QUERY ? NL_QUERY_CAPACITY : AUTH_CAPACITY;
        Bandwidth limit = Bandwidth.classic(capacity, Refill.greedy(capacity, REFILL_DURATION));
        return Bucket.builder().addLimit(limit).build();
    }

    private enum RateLimitCategory {
        AUTH,
        NL_QUERY
    }
}
