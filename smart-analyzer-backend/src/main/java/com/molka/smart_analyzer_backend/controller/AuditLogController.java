package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.dto.AuditLogResponse;
import com.molka.smart_analyzer_backend.dto.PageResponse;
import com.molka.smart_analyzer_backend.repository.UserRepository;
import com.molka.smart_analyzer_backend.service.AuditLogService;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/audit")
public class AuditLogController {

    private final AuditLogService auditLogService;
    private final UserRepository  userRepository;

    public AuditLogController(AuditLogService auditLogService, UserRepository userRepository) {
        this.auditLogService = auditLogService;
        this.userRepository  = userRepository;
    }

    /** Current user's own audit logs (paginated, newest first). */
    @GetMapping
    public ResponseEntity<PageResponse<AuditLogResponse>> getMyLogs(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "20") int size,
            Authentication auth) {
        Long userId = resolveUserId(auth);
        Pageable pageable = PageRequest.of(page, Math.min(size, 100));
        return ResponseEntity.ok(auditLogService.getLogsForUser(userId, pageable));
    }

    /** All users' audit logs — admin only (enforced in SecurityConfig). */
    @GetMapping("/all")
    public ResponseEntity<PageResponse<AuditLogResponse>> getAllLogs(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "20") int size) {
        Pageable pageable = PageRequest.of(page, Math.min(size, 100));
        return ResponseEntity.ok(auditLogService.getAllLogs(pageable));
    }

    private Long resolveUserId(Authentication auth) {
        return userRepository.findByUsername(auth.getName())
                .orElseThrow(() -> new IllegalStateException("Authenticated user not found"))
                .getId();
    }
}
