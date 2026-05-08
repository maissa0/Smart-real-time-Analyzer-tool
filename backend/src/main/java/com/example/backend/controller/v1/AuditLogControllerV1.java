package com.example.backend.controller.v1;

import com.example.backend.dto.common.PageResponse;
import com.example.backend.dto.v1.AuditLogResponse;
import com.example.backend.security.CurrentUserService;
import com.example.backend.service.AuditLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/audit-logs")
@RequiredArgsConstructor
@Tag(name = "Audit Logs V1", description = "Audit log listing with pagination and filters")
public class AuditLogControllerV1 {

    private final AuditLogService auditLogService;
    private final CurrentUserService currentUserService;

    @GetMapping
    @PreAuthorize("hasRole('ADMIN') or hasAuthority('audit:view')")
    @Operation(summary = "List audit logs with pagination and optional filters")
    public ResponseEntity<PageResponse<AuditLogResponse>> getAuditLogs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) UUID userId
    ) {
        PageResponse<AuditLogResponse> result = auditLogService.getAuditLogs(page, size, action, userId);
        return ResponseEntity.ok(result);
    }
}
