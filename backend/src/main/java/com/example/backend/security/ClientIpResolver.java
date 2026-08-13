package com.example.backend.security;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Resolves the client IP for rate limiting, session, and audit records.
 * X-Forwarded-For is only trusted when the direct TCP peer (request.getRemoteAddr())
 * is a configured trusted proxy — otherwise any client could set an arbitrary
 * X-Forwarded-For value to spoof its IP and defeat IP-based rate limiting.
 */
@Component
public class ClientIpResolver {

    private final List<String> trustedProxies;

    public ClientIpResolver(@Value("${app.security.trusted-proxies:}") String trustedProxiesProperty) {
        this.trustedProxies = Arrays.stream(trustedProxiesProperty.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toList());
    }

    public String resolve(HttpServletRequest request) {
        String remoteAddr = request.getRemoteAddr();
        if (!trustedProxies.contains(remoteAddr)) {
            return remoteAddr;
        }
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0].trim();
        }
        return remoteAddr;
    }
}
