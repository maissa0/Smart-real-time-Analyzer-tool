package com.example.backend.service;

import com.example.backend.entity.AuditLogEntity;
import com.example.backend.entity.AuditLogEntity.AuditSource;
import com.example.backend.repository.AuditLogRepository;
import com.example.backend.security.ClientIpResolver;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuditService {

    private final AuditLogRepository auditLogRepository;
    private final ClientIpResolver clientIpResolver;

    // Not @Async itself: logSecurity/logAudit are the actual entry points called by other
    // beans, so @Async must live on them — an @Async here would be a same-class self-invocation
    // that bypasses the Spring AOP proxy and silently runs synchronously.
    private void log(String action, String resource, String resourceId, UUID userId,
                    Map<String, String> metadata, AuditSource source, HttpServletRequest request) {
        String ipAddress = request != null ? clientIpResolver.resolve(request) : null;
        String userAgent = request != null ? request.getHeader("User-Agent") : null;
        if (userAgent != null && userAgent.length() > 500) userAgent = userAgent.substring(0, 500);

        AuditLogEntity log = AuditLogEntity.builder()
                .userId(userId)
                .action(action)
                .resource(resource)
                .resourceId(resourceId)
                .metadata(metadata)
                .ipAddress(ipAddress)
                .userAgent(userAgent)
                .source(source)
                .build();
        auditLogRepository.save(log);
    }

    @Async
    public void logSecurity(String action, String resource, String resourceId, UUID userId,
                            Map<String, String> metadata, HttpServletRequest request) {
        log(action, resource, resourceId, userId, metadata, AuditSource.security, request);
    }

    @Async
    public void logAudit(String action, String resource, String resourceId, UUID userId,
                         Map<String, String> metadata, HttpServletRequest request) {
        log(action, resource, resourceId, userId, metadata, AuditSource.audit, request);
    }
}
