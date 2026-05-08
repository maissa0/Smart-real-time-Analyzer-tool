package com.example.backend.service;

import com.example.backend.entity.AuditLogEntity;
import com.example.backend.entity.AuditLogEntity.AuditSource;
import com.example.backend.repository.AuditLogRepository;
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

    @Async
    public void log(String action, String resource, String resourceId, UUID userId,
                    Map<String, Object> metadata, AuditSource source, HttpServletRequest request) {
        String ipAddress = request != null ? getClientIp(request) : null;
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

    public void logSecurity(String action, String resource, String resourceId, UUID userId,
                            Map<String, Object> metadata, HttpServletRequest request) {
        log(action, resource, resourceId, userId, metadata, AuditSource.security, request);
    }

    public void logAudit(String action, String resource, String resourceId, UUID userId,
                         Map<String, Object> metadata, HttpServletRequest request) {
        log(action, resource, resourceId, userId, metadata, AuditSource.audit, request);
    }

    private String getClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
