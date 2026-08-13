package com.example.backend.can.controller;

import com.example.backend.audit.AuditLog;
import com.example.backend.can.dto.LogFileHistoryDto;
import com.example.backend.can.dto.LogFileStatusDto;
import com.example.backend.can.service.LogFileService;
import com.example.backend.can.service.LogUploadService;
import com.example.backend.exception.SafeErrorMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/logs")
@RequiredArgsConstructor
@Slf4j
public class LogUploadController {

    private final LogUploadService logUploadService;
    private final LogFileService logFileService;

    @PreAuthorize("hasAuthority('log:upload') or hasRole('ADMIN')")
    @AuditLog(action = "LOG_UPLOAD", resource = "logs")
    @PostMapping("/upload")
    public ResponseEntity<Map<String, String>> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "carUid", required = false) String carUid) {

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "File is empty"));
        }
        String name = file.getOriginalFilename() != null ? file.getOriginalFilename() : "";
        if (!name.endsWith(".txt") && !name.endsWith(".log")
                && !name.endsWith(".asc") && !name.endsWith(".blf")) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Unsupported file type. Use .txt .log .asc or .blf"));
        }
        try {
            String sessionId = logUploadService.processUpload(file, carUid);
            return ResponseEntity.ok(Map.of(
                    "sessionId", sessionId,
                    "filename",  name,
                    "status",    "PROCESSING"
            ));
        } catch (Exception e) {
            log.error("Upload failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Upload failed")));
        }
    }

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/status/{sessionId}")
    public ResponseEntity<LogFileStatusDto> getStatus(@PathVariable String sessionId) {
        return logFileService.getStatus(sessionId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/history")
    public ResponseEntity<List<LogFileHistoryDto>> getHistory(
            @RequestParam(defaultValue = "10") int size) {
        return ResponseEntity.ok(logFileService.getHistory(size));
    }

    @PreAuthorize("hasAuthority('log:upload') or hasRole('ADMIN')")
    @AuditLog(action = "LOG_RETRY", resource = "logs", resourceIdParam = "logFileId")
    @PostMapping("/retry/{logFileId}")
    public ResponseEntity<Map<String, String>> retry(@PathVariable Long logFileId) {
        try {
            return logUploadService.retryById(logFileId)
                    .map(ResponseEntity::ok)
                    .orElse(ResponseEntity.notFound().build());
        } catch (Exception e) {
            log.error("Retry failed for logFileId={}", logFileId, e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Retry failed")));
        }
    }
}
