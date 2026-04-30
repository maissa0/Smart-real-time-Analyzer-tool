package com.molka.smart_analyzer_backend.service;

import com.molka.smart_analyzer_backend.dto.AuditLogResponse;
import com.molka.smart_analyzer_backend.dto.PageResponse;
import com.molka.smart_analyzer_backend.entity.AuditLogEntity;
import com.molka.smart_analyzer_backend.repository.AuditLogRepository;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuditLogService {

    private final AuditLogRepository auditLogRepository;

    // ── Write ─────────────────────────────────────────────────────────────────

    /**
     * Persists one audit entry asynchronously so it never delays a response.
     * {@code request} may be null (e.g. when called from background tasks).
     */
    @Async
    public void log(Long userId,
                    String username,
                    String action,
                    String resourceType,
                    String resourceId,
                    String details,
                    HttpServletRequest request) {
        try {
            AuditLogEntity entry = AuditLogEntity.builder()
                    .userId(userId)
                    .username(username)
                    .action(action)
                    .resourceType(resourceType)
                    .resourceId(resourceId)
                    .details(details)
                    .ipAddress(request != null ? extractIp(request) : null)
                    .userAgent(request != null ? truncate(request.getHeader("User-Agent"), 512) : null)
                    .build();
            auditLogRepository.save(entry);
        } catch (Exception e) {
            log.warn("Audit log write failed for action={}: {}", action, e.getMessage());
        }
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    public PageResponse<AuditLogResponse> getLogsForUser(Long userId, Pageable pageable) {
        Page<AuditLogEntity> page =
                auditLogRepository.findByUserIdOrderByTimestampDesc(userId, pageable);
        return toPageResponse(page);
    }

    public PageResponse<AuditLogResponse> getAllLogs(Pageable pageable) {
        Page<AuditLogEntity> page =
                auditLogRepository.findAllByOrderByTimestampDesc(pageable);
        return toPageResponse(page);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private PageResponse<AuditLogResponse> toPageResponse(Page<AuditLogEntity> page) {
        return new PageResponse<>(
                page.getContent().stream().map(this::toResponse).toList(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages(),
                page.isFirst(),
                page.isLast()
        );
    }

    private AuditLogResponse toResponse(AuditLogEntity e) {
        return new AuditLogResponse(
                e.getId(),
                e.getUserId(),
                e.getUsername(),
                e.getAction(),
                e.getResourceType(),
                e.getResourceId(),
                e.getIpAddress(),
                e.getUserAgent(),
                e.getTimestamp(),
                e.getDetails()
        );
    }

    private String extractIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        return request.getRemoteAddr();
    }

    private String truncate(String value, int max) {
        if (value == null) return null;
        return value.length() > max ? value.substring(0, max) : value;
    }
}
