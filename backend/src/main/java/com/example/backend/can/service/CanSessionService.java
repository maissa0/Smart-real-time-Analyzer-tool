package com.example.backend.can.service;

import com.example.backend.can.dto.CanFrameResponse;
import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.repository.CanFrameRepository;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.repository.LogFileRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class CanSessionService {

    private final CanSessionRepository canSessionRepository;
    private final CarRepository carRepository;
    private final CanFrameRepository canFrameRepository;
    private final IntegrityFaultRepository integrityFaultRepository;
    private final LogFileRepository logFileRepository;
    private final ObjectMapper objectMapper;
    private final IntegrityAnalyzerService integrityAnalyzerService;

    @Value("${pipeline.uploads.dir}")
    private String uploadsDir;

    public CanSessionEntity saveSession(String json) throws JsonProcessingException {
        Map<String, Object> map = objectMapper.readValue(json, new TypeReference<>() {});
        String sessionId = stringVal(map.get("session_id"));
        return canSessionRepository.findBySessionId(sessionId).orElseGet(() -> {
            CanSessionEntity.CanSessionEntityBuilder builder = CanSessionEntity.builder()
                    .sessionId(sessionId)
                    .sourceFilename(stringVal(map.get("source_filename")))
                    .startTs(toDouble(map.get("start_ts")))
                    .endTs(toDouble(map.get("end_ts")))
                    .frameCount(toInteger(map.get("frame_count")));
            // Link to vehicle if car_uid is present in the message
            String carUid = (String) map.get("car_uid");
            if (carUid != null && !carUid.isBlank()) {
                carRepository.findByCarUid(carUid)
                        .ifPresent(car -> builder.carId(car.getId()));
            }
            return canSessionRepository.save(builder.build());
        });
    }

    public CanFrameEntity saveFrame(String json) throws JsonProcessingException {
        Map<String, Object> map = objectMapper.readValue(json, new TypeReference<>() {});
        String rawBytesJson = objectMapper.writeValueAsString(map.get("raw_bytes"));
        String signalsJson = objectMapper.writeValueAsString(map.get("signals"));
        CanFrameEntity entity = CanFrameEntity.builder()
                .sessionId(stringVal(map.get("session_id")))
                .timestamp(toDouble(map.get("timestamp")))
                .channel(toInteger(map.get("channel")))
                .channelName(stringVal(map.get("channel_name")))
                .msgId(stringVal(map.get("msg_id")))
                .msgName(stringVal(map.get("msg_name")))
                .direction(stringVal(map.get("direction")))
                .rawBytes(rawBytesJson)
                .signals(signalsJson)
                .build();
        CanFrameEntity saved = canFrameRepository.save(entity);
        canSessionRepository.incrementFrameCount(saved.getSessionId());
        return saved;
    }

    public List<CanSessionResponse> getAllSessions() {
        return canSessionRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(this::toSessionResponse)
                .toList();
    }

    public Map<String, Object> getSessions(int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<CanSessionEntity> pageResult = canSessionRepository
                .findAllByOrderByCreatedAtDesc(pageable);
        return Map.of(
                "content", pageResult.getContent().stream()
                        .map(this::toSessionResponse)
                        .toList(),
                "page", page,
                "size", size,
                "totalElements", pageResult.getTotalElements(),
                "totalPages", pageResult.getTotalPages(),
                "hasMore", !pageResult.isLast()
        );
    }

    public List<CanFrameResponse> getFramesBySession(String sessionId) {
        return canFrameRepository.findBySessionIdOrderByTimestampAsc(sessionId).stream()
                .map(this::toFrameResponse)
                .toList();
    }

    public List<CanFrameResponse> getFramesBySessionAndMsgId(String sessionId, String msgId) {
        return canFrameRepository.findBySessionIdAndMsgIdOrderByTimestampAsc(sessionId, msgId).stream()
                .map(this::toFrameResponse)
                .toList();
    }

    /**
     * Returns frames for a session that have at least one integrity fault.
     * Uses IntegrityFaultRepository to find affected frame IDs,
     * then loads only those frames.
     */
    public List<CanFrameResponse> getFramesWithFaults(String sessionId) {
        List<Long> faultFrameIds = integrityFaultRepository
                .findBySessionIdOrderByFrameTimestampAsc(sessionId)
                .stream()
                .filter(f -> f.getFrameId() != null)
                .map(f -> f.getFrameId())
                .distinct()
                .toList();

        if (faultFrameIds.isEmpty()) return List.of();

        return canFrameRepository
                .findAllById(faultFrameIds)
                .stream()
                .sorted(Comparator.comparingDouble(CanFrameEntity::getTimestamp))
                .map(this::toFrameResponse)
                .toList();
    }

    @Transactional
    public Map<String, Object> deleteSession(String sessionId) {
        // Count before deleting for summary response
        long frameCount = canFrameRepository.countBySessionId(sessionId);
        long faultCount = integrityFaultRepository.countBySessionId(sessionId);
        boolean sessionExists = canSessionRepository.findBySessionId(sessionId).isPresent();

        if (!sessionExists) {
            throw new RuntimeException("Session not found: " + sessionId);
        }

        // Delete in correct order (faults and frames first, then session)
        integrityFaultRepository.deleteBySessionId(sessionId);
        canFrameRepository.deleteBySessionId(sessionId);
        canSessionRepository.deleteBySessionId(sessionId);

        // Clear per-session state from IntegrityAnalyzerService maps
        // Prevents unbounded memory growth in lastTimestamp and lastRawBytes
        integrityAnalyzerService.clearSession(sessionId);

        // Delete log_files record if exists
        logFileRepository.findBySessionId(sessionId).ifPresent(lf -> {
            // Delete file from disk if it exists
            if (lf.getFilename() != null) {
                try {
                    Path filePath = Paths.get(uploadsDir)
                            .resolve(sessionId + "_" + lf.getFilename());
                    Files.deleteIfExists(filePath);
                    log.info("Deleted file from disk: {}", filePath);
                } catch (Exception e) {
                    log.warn("Could not delete file from disk: {}", e.getMessage());
                }
            }
            logFileRepository.delete(lf);
            log.info("Deleted log_files record for session: {}", sessionId);
        });

        return Map.of(
                "sessionId", sessionId,
                "deletedFrames", frameCount,
                "deletedFaults", faultCount,
                "status", "deleted"
        );
    }

    /**
     * Get all sessions for a specific car, ordered by creation date descending.
     * Used by CarController GET /api/cars/{carUid}/sessions.
     *
     * @param carId internal DB id of the car
     * @return list of CanSessionResponse ordered by createdAt DESC
     */
    public List<CanSessionResponse> getSessionsByCarId(Long carId) {
        return canSessionRepository.findByCarIdOrderByCreatedAtDesc(carId)
                .stream()
                .map(this::toSessionResponse)
                .toList();
    }

    private CanSessionResponse toSessionResponse(CanSessionEntity e) {
        return new CanSessionResponse(
                e.getId(),
                e.getSessionId(),
                e.getSourceFilename(),
                e.getStartTs(),
                e.getEndTs(),
                e.getFrameCount(),
                e.getCreatedAt()
        );
    }

    private CanFrameResponse toFrameResponse(CanFrameEntity e) {
        return new CanFrameResponse(
                e.getId(),
                e.getSessionId(),
                e.getTimestamp(),
                e.getChannel(),
                e.getChannelName(),
                e.getMsgId(),
                e.getMsgName(),
                e.getDirection(),
                e.getRawBytes(),
                e.getSignals()
        );
    }

    private static String stringVal(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static Double toDouble(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof Number n) {
            return n.doubleValue();
        }
        return Double.parseDouble(o.toString());
    }

    private static Integer toInteger(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof Number n) {
            return n.intValue();
        }
        return Integer.parseInt(o.toString());
    }
}
