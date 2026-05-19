package com.example.backend.can.controller;

import com.example.backend.audit.AuditLog;
import com.example.backend.can.repository.LogFileRepository;
import com.example.backend.can.service.LogUploadService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/logs")
@RequiredArgsConstructor
@Slf4j
public class LogUploadController {

    private final LogUploadService logUploadService;
    private final LogFileRepository logFileRepository;

    /** Upload a CAN log file (.txt/.log/.asc/.blf); job is queued for async processing. */
    @AuditLog(action = "LOG_UPLOAD", resource = "logs")
    @PostMapping("/upload")
    public ResponseEntity<Map<String, String>> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "carUid", required = false) String carUid) {

        if (file.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "File is empty"));
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
                    "filename", name,
                    "status", "PROCESSING"
            ));
        } catch (Exception e) {
            log.error("Upload failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/status/{sessionId}")
    public ResponseEntity<Map<String, Object>> getStatus(@PathVariable String sessionId) {
        return logFileRepository.findBySessionId(sessionId)
                .map(lf -> {
                    Map<String, Object> body = new HashMap<>();
                    body.put("sessionId", lf.getSessionId());
                    body.put("filename", lf.getFilename());
                    body.put("status", lf.getStatus());
                    body.put("frameCount", lf.getFrameCount() != null ? lf.getFrameCount() : 0);
                    body.put("fileSize", lf.getFileSize() != null ? lf.getFileSize() : 0);
                    body.put("channelCount", lf.getChannelCount() != null ? lf.getChannelCount() : 0);
                    body.put("durationSeconds", lf.getDurationSeconds() != null ? lf.getDurationSeconds() : 0.0);
                    body.put("createdAt", lf.getCreatedAt() != null ? lf.getCreatedAt().toString() : "");
                    return ResponseEntity.ok(body);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Upload history — last N log files ordered by createdAt DESC.
     * GET /api/logs/history?size=10
     */
    @GetMapping("/history")
    public ResponseEntity<List<Map<String, Object>>> getHistory(
            @RequestParam(defaultValue = "10") int size) {
        List<Map<String, Object>> history = logFileRepository
                .findTopNOrderByCreatedAtDesc(size)
                .stream()
                .map(lf -> {
                    Map<String, Object> item = new HashMap<>();
                    item.put("id", lf.getId());
                    item.put("sessionId", lf.getSessionId());
                    item.put("filename", lf.getFilename());
                    item.put("status", lf.getStatus());
                    item.put("frameCount", lf.getFrameCount() != null ? lf.getFrameCount() : 0);
                    item.put("fileSize", lf.getFileSize() != null ? lf.getFileSize() : 0);
                    item.put("createdAt", lf.getCreatedAt() != null ? lf.getCreatedAt().toString() : "");
                    return item;
                })
                .collect(Collectors.toList());
        return ResponseEntity.ok(history);
    }

    /**
     * Retry a failed upload — re-queues the log file for processing.
     * POST /api/logs/retry/{logFileId}
     */
    @AuditLog(action = "LOG_RETRY", resource = "logs", resourceIdParam = "logFileId")
    @PostMapping("/retry/{logFileId}")
    public ResponseEntity<Map<String, String>> retry(@PathVariable Long logFileId) {
        return logFileRepository.findById(logFileId)
                .map(lf -> {
                    try {
                        String sessionId = logUploadService.retryProcessing(lf);
                        return ResponseEntity.ok(Map.of(
                                "sessionId", sessionId,
                                "status", "PROCESSING"
                        ));
                    } catch (Exception e) {
                        log.error("Retry failed for logFileId={}", logFileId, e);
                        return ResponseEntity.internalServerError()
                                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Retry failed"));
                    }
                })
                .orElse(ResponseEntity.notFound().build());
    }
}
