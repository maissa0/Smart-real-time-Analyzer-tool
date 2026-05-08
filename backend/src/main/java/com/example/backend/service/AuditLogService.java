package com.example.backend.service;

import com.example.backend.dto.common.PageResponse;
import com.example.backend.dto.v1.AuditLogResponse;
import com.example.backend.entity.AuditLogEntity;
import com.example.backend.repository.AuditLogRepository;
import com.example.backend.repository.AuditLogSpecification;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AuditLogService {

    private final AuditLogRepository auditLogRepository;

    public PageResponse<AuditLogResponse> getAuditLogs(int page, int size, String action, UUID userId) {
        Specification<AuditLogEntity> spec = Specification.where(AuditLogSpecification.withAction(action))
                .and(AuditLogSpecification.withUserId(userId));
        PageRequest pageRequest = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<AuditLogEntity> result = auditLogRepository.findAll(spec, pageRequest);

        var content = result.getContent().stream()
                .map(this::toResponse)
                .collect(Collectors.toList());

        return PageResponse.<AuditLogResponse>builder()
                .content(content)
                .page(result.getNumber())
                .size(result.getSize())
                .totalElements(result.getTotalElements())
                .totalPages(result.getTotalPages())
                .first(result.isFirst())
                .last(result.isLast())
                .build();
    }

    private AuditLogResponse toResponse(AuditLogEntity e) {
        return new AuditLogResponse(
                e.getId().toString(),
                e.getUserId() != null ? e.getUserId().toString() : null,
                e.getAction(),
                e.getResource(),
                e.getResourceId(),
                e.getMetadata(),
                e.getIpAddress(),
                e.getUserAgent(),
                e.getSource(),
                e.getCreatedAt()
        );
    }
}
