package com.example.backend.can.service;

import com.example.backend.can.entity.LogFileEntity;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.LogFileRepository;
import com.example.backend.can.dto.LogFileEventPayload;
import com.example.backend.can.dto.LogFileHistoryDto;
import com.example.backend.can.dto.LogFileStatusDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class LogFileService {

    private final LogFileRepository logFileRepository;
    private final CanSessionRepository canSessionRepository;
    private final ObjectMapper objectMapper;

    public void saveLogFileEvent(String json) {
        try {
            LogFileEventPayload data = objectMapper.readValue(json, LogFileEventPayload.class);

            String sessionId = data.sessionId();
            if (sessionId == null) return;

            String event = data.event() != null ? data.event() : "metadata";

            if ("metadata".equals(event)) {
                LogFileEntity entity = logFileRepository
                        .findBySessionId(sessionId)
                        .orElse(LogFileEntity.builder()
                                .sessionId(sessionId)
                                .build());

                entity.setFilename(data.filename() != null ? data.filename() : "unknown");
                entity.setFileSize(data.fileSize());
                entity.setFormat(data.format());
                entity.setChannelCount(data.channelCount());
                entity.setFrameCount(data.frameCount());
                entity.setStartTs(data.startTs());
                entity.setEndTs(data.endTs());
                entity.setDurationSeconds(data.durationSeconds());
                entity.setStatus("PROCESSING");

                logFileRepository.save(entity);
                log.info("Log file metadata saved: session={} file={} frames={}",
                        sessionId, entity.getFilename(), entity.getFrameCount());

            } else if ("complete".equals(event)) {
                logFileRepository.findBySessionId(sessionId).ifPresent(entity -> {
                    entity.setStatus("COMPLETED");
                    entity.setCompletedAt(LocalDateTime.now());
                    if (data.frameCount() != null) {
                        entity.setFrameCount(data.frameCount());
                    }
                    logFileRepository.save(entity);
                    log.info("Log file processing complete: session={}", sessionId);
                });
                canSessionRepository.findBySessionId(sessionId).ifPresent(session -> {
                    session.setStatus("COMPLETE");
                    if (data.frameCount() != null) {
                        session.setFrameCount(data.frameCount());
                    }
                    canSessionRepository.save(session);
                    log.info("CAN session marked COMPLETE: session={}", sessionId);
                });

            } else if ("error".equals(event)) {
                logFileRepository.findBySessionId(sessionId).ifPresent(entity -> {
                    entity.setStatus("FAILED");
                    entity.setErrorMessage(data.error() != null ? data.error() : "Unknown error");
                    entity.setCompletedAt(LocalDateTime.now());
                    logFileRepository.save(entity);
                    log.error("Log file processing error: session={} error={}",
                            sessionId, entity.getErrorMessage());
                });
                canSessionRepository.findBySessionId(sessionId).ifPresent(session -> {
                    session.setStatus("ERROR");
                    canSessionRepository.save(session);
                    log.error("CAN session marked ERROR: session={}", sessionId);
                });
            }

        } catch (Exception e) {
            log.error("Failed to process log-file-events message", e);
        }
    }

    // ── Query methods ─────────────────────────────────────────────────────────

    /**
     * Returns the upload status record for a session, projected to a response map.
     * Returns empty when no log file record exists yet for the session.
     */
    public Optional<LogFileStatusDto> getStatus(String sessionId) {
        return logFileRepository.findBySessionId(sessionId).map(lf -> new LogFileStatusDto(
                lf.getSessionId(),
                lf.getFilename(),
                lf.getStatus(),
                lf.getFrameCount()      != null ? lf.getFrameCount()     : 0,
                lf.getFileSize()        != null ? lf.getFileSize()        : 0L,
                lf.getChannelCount()    != null ? lf.getChannelCount()    : 0,
                lf.getDurationSeconds() != null ? lf.getDurationSeconds() : 0.0,
                lf.getCreatedAt()       != null ? lf.getCreatedAt().toString() : ""
        ));
    }

    /**
     * Returns the last {@code size} upload records ordered by createdAt DESC,
     * projected to a list of response maps.
     */
    public List<LogFileHistoryDto> getHistory(int size) {
        return logFileRepository.findTopNOrderByCreatedAtDesc(size)
                .stream()
                .map(lf -> new LogFileHistoryDto(
                        lf.getId(),
                        lf.getSessionId(),
                        lf.getFilename(),
                        lf.getStatus(),
                        lf.getFrameCount() != null ? lf.getFrameCount() : 0,
                        lf.getFileSize()   != null ? lf.getFileSize()   : 0L,
                        lf.getCreatedAt()  != null ? lf.getCreatedAt().toString() : ""
                ))
                .toList();
    }

}
