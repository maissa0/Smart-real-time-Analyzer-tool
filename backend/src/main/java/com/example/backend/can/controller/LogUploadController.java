package com.example.backend.can.controller;

import com.example.backend.can.repository.LogFileRepository;
import com.example.backend.can.service.LogUploadService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/logs")
@RequiredArgsConstructor
@Slf4j
public class LogUploadController {

    private final LogUploadService logUploadService;
    private final LogFileRepository logFileRepository;

    /** Upload a CAN log file (.txt/.log/.asc/.blf); job is queued for async processing. */
    @PostMapping("/upload")
    public ResponseEntity<Map<String, String>> upload(
            @RequestParam("file") MultipartFile file) {

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
            String sessionId = logUploadService.processUpload(file);
            return ResponseEntity.ok(Map.of(
                    "sessionId", sessionId,
                    "filename", name,
                    "status", "processing"
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
}
