package com.example.backend.can.service;

import com.example.backend.can.entity.LogFileEntity;
import com.example.backend.can.repository.LogFileRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class LogFileService {

    private final LogFileRepository logFileRepository;
    private final ObjectMapper objectMapper;

    public void saveLogFileEvent(String json) {
        try {
            Map<String, Object> data = objectMapper.readValue(json, new TypeReference<>() {});

            String sessionId = (String) data.get("session_id");
            if (sessionId == null) return;

            String event = (String) data.getOrDefault("event", "metadata");

            if ("metadata".equals(event)) {
                // Create or update log file record with metadata
                LogFileEntity entity = logFileRepository
                        .findBySessionId(sessionId)
                        .orElse(LogFileEntity.builder()
                                .sessionId(sessionId)
                                .build());

                entity.setFilename((String) data.getOrDefault("filename", "unknown"));
                entity.setFileSize(toLong(data.get("file_size")));
                entity.setFormat((String) data.get("format"));
                entity.setChannelCount(toInteger(data.get("channel_count")));
                entity.setFrameCount(toInteger(data.get("frame_count")));
                entity.setStartTs(toDouble(data.get("start_ts")));
                entity.setEndTs(toDouble(data.get("end_ts")));
                entity.setDurationSeconds(toDouble(data.get("duration_seconds")));
                entity.setStatus("processing");

                logFileRepository.save(entity);
                log.info("Log file metadata saved: session={} file={} frames={}",
                        sessionId, entity.getFilename(), entity.getFrameCount());

            } else if ("complete".equals(event)) {
                logFileRepository.findBySessionId(sessionId).ifPresent(entity -> {
                    entity.setStatus("complete");
                    entity.setCompletedAt(LocalDateTime.now());
                    if (data.containsKey("frame_count")) {
                        entity.setFrameCount(toInteger(data.get("frame_count")));
                    }
                    logFileRepository.save(entity);
                    log.info("Log file processing complete: session={}", sessionId);
                });

            } else if ("error".equals(event)) {
                logFileRepository.findBySessionId(sessionId).ifPresent(entity -> {
                    entity.setStatus("error");
                    entity.setErrorMessage((String) data.getOrDefault("error", "Unknown error"));
                    entity.setCompletedAt(LocalDateTime.now());
                    logFileRepository.save(entity);
                    log.error("Log file processing error: session={} error={}",
                            sessionId, entity.getErrorMessage());
                });
            }

        } catch (Exception e) {
            log.error("Failed to process log-file-events message", e);
        }
    }

    private Long toLong(Object val) {
        if (val instanceof Number n) return n.longValue();
        if (val instanceof String s) { try { return Long.parseLong(s); } catch (Exception ignored) {} }
        return null;
    }

    private Integer toInteger(Object val) {
        if (val instanceof Number n) return n.intValue();
        if (val instanceof String s) { try { return Integer.parseInt(s); } catch (Exception ignored) {} }
        return null;
    }

    private Double toDouble(Object val) {
        if (val instanceof Number n) return n.doubleValue();
        if (val instanceof String s) { try { return Double.parseDouble(s); } catch (Exception ignored) {} }
        return null;
    }
}
