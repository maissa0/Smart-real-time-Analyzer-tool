package com.example.backend.can.service;

import com.example.backend.can.dto.CanFramePayload;
import com.example.backend.can.dto.CanFrameResponse;
import com.example.backend.can.dto.CanSessionPayload;
import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.dto.SessionDeleteResult;
import com.example.backend.can.dto.SessionFrameMetadataDto;
import com.example.backend.dto.common.PageResponse;
import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.repository.CanFrameRepository;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.repository.LogFileRepository;
import com.example.backend.can.entity.LogFileEntity;
import com.example.backend.can.config.KafkaTopicConfig;
import com.example.backend.can.kafka.AnomalyEventConsumer;
import com.example.backend.exception.ResourceNotFoundException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
public class CanSessionService {

    private final CanSessionRepository canSessionRepository;
    private final CarRepository carRepository;
    private final CanFrameRepository canFrameRepository;
    private final IntegrityFaultRepository integrityFaultRepository;
    private final LogFileRepository logFileRepository;
    private final ObjectMapper objectMapper;
    private final IntegrityAnalyzerService integrityAnalyzerService;
    private final RequirementMonitorService requirementMonitorService;
    private final AnomalyEventConsumer anomalyEventConsumer;
    private final FindingCorrelationService findingCorrelationService;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final InfluxWriteService influxWriteService;
    private final InfluxQueryService influxQueryService;
    private final SessionSummaryService sessionSummaryService;
    // Self-injected proxy so deleteSession() can invoke the @Transactional step through Spring's
    // AOP proxy instead of a same-class self-invocation (which would silently run non-transactionally,
    // the same class of bug fixed earlier for AuditService's @Async). @Lazy breaks the circular
    // dependency this would otherwise create at bean-construction time.
    // Explicit constructor (not @RequiredArgsConstructor) — matches SimulatorService's existing
    // precedent in this codebase: Lombok cannot annotate one specific generated constructor
    // parameter with @Lazy while leaving the others untouched.
    private final CanSessionService self;

    @Value("${pipeline.uploads.dir}")
    private String uploadsDir;

    public CanSessionService(
            CanSessionRepository canSessionRepository,
            CarRepository carRepository,
            CanFrameRepository canFrameRepository,
            IntegrityFaultRepository integrityFaultRepository,
            LogFileRepository logFileRepository,
            ObjectMapper objectMapper,
            IntegrityAnalyzerService integrityAnalyzerService,
            RequirementMonitorService requirementMonitorService,
            AnomalyEventConsumer anomalyEventConsumer,
            FindingCorrelationService findingCorrelationService,
            KafkaTemplate<String, String> kafkaTemplate,
            InfluxWriteService influxWriteService,
            InfluxQueryService influxQueryService,
            SessionSummaryService sessionSummaryService,
            @Lazy CanSessionService self
    ) {
        this.canSessionRepository = canSessionRepository;
        this.carRepository = carRepository;
        this.canFrameRepository = canFrameRepository;
        this.integrityFaultRepository = integrityFaultRepository;
        this.logFileRepository = logFileRepository;
        this.objectMapper = objectMapper;
        this.integrityAnalyzerService = integrityAnalyzerService;
        this.requirementMonitorService = requirementMonitorService;
        this.anomalyEventConsumer = anomalyEventConsumer;
        this.findingCorrelationService = findingCorrelationService;
        this.kafkaTemplate = kafkaTemplate;
        this.influxWriteService = influxWriteService;
        this.influxQueryService = influxQueryService;
        this.sessionSummaryService = sessionSummaryService;
        this.self = self;
    }

    // ── Session persistence ───────────────────────────────────────────────────────

    public CanSessionEntity saveSession(String json) throws JsonProcessingException {
        CanSessionPayload payload = objectMapper.readValue(json, CanSessionPayload.class);
        String sessionId = payload.sessionId();
        String status = payload.status();

        // Push startTs into InfluxWriteService cache before any frame is written.
        influxWriteService.registerSessionStartTs(sessionId, payload.startTs());

        // Status update path — update status AND frame count from the completion payload.
        if (status != null && !status.isBlank()) {
            return canSessionRepository.findBySessionId(sessionId).map(existing -> {
                existing.setStatus(status);
                if ("COMPLETE".equals(status)) {
                    long influxCount = influxWriteService.countFrames(sessionId, null, null, null);
                    existing.setFrameCount((int) influxCount);
                    // Overwrite startTs/endTs with actual frame timestamps (simulator may set
                    // endTs to a far-future default). Both entity and cache hold Unix seconds —
                    // must stay unconverted so it matches PlaybackController/InfluxController,
                    // which both treat startTs/endTs as Unix seconds.
                    double firstTs = influxWriteService.getSessionStartTs(sessionId);
                    double lastTs  = influxWriteService.getSessionLastTs(sessionId);
                    if (firstTs > 0 && lastTs > firstTs) {
                        existing.setStartTs(firstTs);
                        existing.setEndTs(lastTs);
                    }
                } else if (payload.frameCount() != null) {
                    existing.setFrameCount(payload.frameCount());
                }
                log.info("Session status updated: id={} status={} frameCount={}",
                        sessionId, status, existing.getFrameCount());
                CanSessionEntity saved = canSessionRepository.save(existing);
                if ("COMPLETE".equals(status)) {
                    sessionSummaryService.generateAsync(sessionId);
                    // Free IntegrityAnalyzerService's per-session state maps as soon as the
                    // session naturally completes, not only on explicit delete — prevents
                    // unbounded growth for sessions that finish but are never deleted.
                    integrityAnalyzerService.clearSession(sessionId);
                    // Snapshots PASS counters before dropping engine state, so the
                    // requirements report survives a backend restart.
                    requirementMonitorService.completeSession(sessionId);
                    anomalyEventConsumer.clearSession(sessionId);
                    findingCorrelationService.clearSession(sessionId);
                    publishSessionCleanVerdict(sessionId);
                }
                return saved;
            }).orElseGet(() -> {
                CanSessionEntity entity = CanSessionEntity.builder()
                        .sessionId(sessionId)
                        .sourceFilename(payload.sourceFilename())
                        .startTs(payload.startTs())
                        .endTs(payload.endTs())
                        .frameCount(payload.frameCount())
                        .status(status)
                        .build();
                return canSessionRepository.save(entity);
            });
        }

        // Normal session creation — only create if not exists.
        return canSessionRepository.findBySessionId(sessionId).orElseGet(() -> {
            CanSessionEntity.CanSessionEntityBuilder builder = CanSessionEntity.builder()
                    .sessionId(sessionId)
                    .sourceFilename(payload.sourceFilename())
                    .startTs(payload.startTs())
                    .endTs(payload.endTs())
                    .frameCount(payload.frameCount());
            String carUid = payload.carUid();
            if (carUid != null && !carUid.isBlank()) {
                carRepository.findByCarUid(carUid)
                        .ifPresent(car -> builder.carId(car.getId()));
            }
            return canSessionRepository.save(builder.build());
        });
    }

    /**
     * Tell the Phase-4 anomaly engine whether this completed session is safe
     * to learn from: clean = zero SPEC/REQUIREMENT findings (advisory ML
     * findings don't count). Published on session COMPLETE; the engine merges
     * that session's baseline candidates only on a clean verdict, which is
     * what prevents baseline self-poisoning (plan §4.4). Late deadline-sweep
     * findings after COMPLETE are accepted as a rare, benign race.
     */
    private void publishSessionCleanVerdict(String sessionId) {
        try {
            long findings = integrityFaultRepository
                    .countBySessionIdAndLayerNot(sessionId, "ML");
            String payload = objectMapper.writeValueAsString(Map.of(
                    "session_id", sessionId,
                    "clean", findings == 0,
                    "findings", findings));
            kafkaTemplate.send(KafkaTopicConfig.TOPIC_SESSION_CLEAN, sessionId, payload);
            log.info("Session {} clean verdict published: clean={} ({} finding(s))",
                    sessionId, findings == 0, findings);
        } catch (Exception e) {
            log.warn("Could not publish clean verdict for session {}: {}",
                    sessionId, e.getMessage());
        }
    }

    // ── Frame ingestion ───────────────────────────────────────────────────────────

    /**
     * Builds a transient CanFrameEntity from Kafka JSON without persisting to MySQL.
     * Frames are stored exclusively in InfluxDB (can_frames measurement).
     * The returned entity has id=null — downstream code must not call .getId() on it.
     */
    public CanFrameEntity buildTransientFrame(String json) throws JsonProcessingException {
        CanFramePayload payload = objectMapper.readValue(json, CanFramePayload.class);
        String rawBytesJson = objectMapper.writeValueAsString(payload.rawBytes());
        return CanFrameEntity.builder()
                .sessionId(payload.sessionId())
                .timestamp(payload.timestamp())
                .channel(payload.channel())
                .channelName(payload.channelName())
                .msgId(payload.msgId())
                .msgName(payload.msgName())
                .direction(payload.direction())
                .rawBytes(rawBytesJson)
                .frameSeq(payload.frameSeq())
                .build();
    }

    // ── Session reads ─────────────────────────────────────────────────────────────

    public List<CanSessionResponse> getAllSessions() {
        return canSessionRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(this::toSessionResponse)
                .toList();
    }

    public PageResponse<CanSessionResponse> getSessions(int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        org.springframework.data.domain.Page<CanSessionEntity> pageResult =
                canSessionRepository.findAllByOrderByCreatedAtDesc(pageable);
        return PageResponse.<CanSessionResponse>builder()
                .content(pageResult.getContent().stream()
                        .map(this::toSessionResponse)
                        .toList())
                .page(page)
                .size(size)
                .totalElements(pageResult.getTotalElements())
                .totalPages(pageResult.getTotalPages())
                .first(pageResult.isFirst())
                .last(pageResult.isLast())
                .build();
    }

    public List<CanSessionResponse> getSessionsByCarId(Long carId) {
        return canSessionRepository.findByCarIdOrderByCreatedAtDesc(carId)
                .stream()
                .map(this::toSessionResponse)
                .toList();
    }

    // ── Frame reads — all sourced from InfluxDB can_frames measurement ────────────

    /**
     * Returns all frames for a session — used by CSV export.
     * Queries InfluxDB without a page limit.
     */
    public List<CanFrameResponse> getFramesBySession(String sessionId) {
        return influxWriteService.queryAllFrames(sessionId);
    }

    /**
     * Total frame count for a session from InfluxDB can_frames measurement.
     * Used by the frame-count endpoint to compute pagination.
     */
    public long getFrameCount(String sessionId) {
        return influxWriteService.countFrames(sessionId, null, null, null);
    }

    /**
     * Paginated frames with optional msgId, channelName, and faultsOnly filters.
     * All reads come from InfluxDB can_frames measurement.
     *
     * faultsOnly=true: loads fault timestamps from MySQL integrity_faults,
     * converts to absolute nanoseconds using the same formula as writeFrame(),
     * and passes them as a time-point filter to InfluxDB.
     */
    public Page<CanFrameResponse> getFramesFiltered(
            String sessionId, String msgId, String channelName, boolean faultsOnly,
            int page, int size) {

        List<Long> faultNanos = null;
        if (faultsOnly) {
            double startTs = canSessionRepository.findBySessionId(sessionId)
                    .map(CanSessionEntity::getStartTs)
                    .filter(ts -> ts != null)
                    .orElse(0.0);
            faultNanos = integrityFaultRepository
                    .findBySessionIdOrderByFrameTimestampAsc(sessionId)
                    .stream()
                    .filter(f -> f.getFrameTimestamp() != null)
                    .map(f -> {
                        double ft = f.getFrameTimestamp();
                        double absTs = ft > 1_000_000_000.0 ? ft : startTs + ft;
                        return (long) (absTs * 1_000_000_000L);
                    })
                    .distinct()
                    .toList();
        }

        return influxWriteService.queryFramesPaged(
                sessionId,
                msgId != null && !msgId.isBlank() ? msgId : null,
                channelName != null && !channelName.isBlank() ? channelName : null,
                faultNanos,
                page,
                size);
    }

    /**
     * Returns the session's startTs for absolute-timestamp computation during CSV export.
     */
    public double getSessionStartTs(String sessionId) {
        return canSessionRepository.findBySessionId(sessionId)
                .map(CanSessionEntity::getStartTs)
                .filter(ts -> ts != null)
                .orElse(0.0);
    }

    /**
     * Returns lightweight filter-option metadata for a session without loading frames.
     * Distinct msg IDs, buses, and message pairs come from InfluxDB can_frames tags.
     * Signal names come from InfluxDB can_signals tags.
     * Used by GET /api/can/sessions/{id}/metadata.
     */
    public SessionFrameMetadataDto getSessionFrameMetadata(String sessionId, String bus, String msgId) {
        List<String> msgIds   = influxWriteService.queryDistinctMsgIds(sessionId, bus);
        List<String> buses    = influxWriteService.queryDistinctChannelNames(sessionId);
        List<SessionFrameMetadataDto.MessageSummary> messages =
                influxWriteService.queryDistinctMessages(sessionId, bus);
        List<String> signalNames;
        try {
            signalNames = influxQueryService.queryAvailableSignals(sessionId, bus, msgId);
        } catch (Exception e) {
            log.warn("Could not fetch signal names for metadata of session {}: {}",
                    sessionId, e.getMessage());
            signalNames = List.of();
        }
        return new SessionFrameMetadataDto(sessionId, msgIds, buses, messages, signalNames);
    }

    // ── Session delete ────────────────────────────────────────────────────────────

    private record MysqlDeleteResult(long faultCount, String logFilename) {}

    /**
     * Deletes a session's MySQL rows (transactional) and only afterward — outside any
     * transaction — deletes its InfluxDB data and log file, so a DB connection is never
     * held open across those external I/O calls.
     */
    public SessionDeleteResult deleteSession(String sessionId) {
        MysqlDeleteResult mysqlResult = self.deleteSessionMysqlRows(sessionId);

        boolean influxDeleted = false;
        try {
            influxWriteService.deleteSession(sessionId);
            influxDeleted = true;
        } catch (Exception e) {
            log.error("InfluxDB delete failed for session {}: {}", sessionId, e.getMessage());
        }

        if (mysqlResult.logFilename() != null) {
            Path filePath = Paths.get(uploadsDir).resolve(sessionId + "_" + mysqlResult.logFilename());
            try {
                Files.deleteIfExists(filePath);
            } catch (Exception e) {
                log.warn("Could not delete file from disk: {}", e.getMessage());
            }
        }

        return SessionDeleteResult.builder()
                .sessionId(sessionId)
                .deletedFrames(0L)
                .deletedFaults(mysqlResult.faultCount())
                .status("deleted")
                .influxDeleted(influxDeleted)
                .build();
    }

    // Public only so Spring's AOP proxy can apply @Transactional when called via `self` above —
    // not intended to be called directly from outside deleteSession().
    @Transactional
    public MysqlDeleteResult deleteSessionMysqlRows(String sessionId) {
        long faultCount = integrityFaultRepository.countBySessionId(sessionId);

        if (!canSessionRepository.findBySessionId(sessionId).isPresent()) {
            throw new ResourceNotFoundException("Session", sessionId);
        }

        // 1. MySQL can_frames — always 0 rows after migration, kept for safety
        canFrameRepository.deleteBySessionId(sessionId);

        // 2. MySQL integrity_faults
        log.info("Deleting {} fault(s) from MySQL for session: {}", faultCount, sessionId);
        integrityFaultRepository.deleteBySessionId(sessionId);

        // 3. MySQL log file record
        String logFilename = null;
        LogFileEntity logFile = logFileRepository.findBySessionId(sessionId).orElse(null);
        if (logFile != null) {
            logFilename = logFile.getFilename();
            logFileRepository.delete(logFile);
        }

        // 4. MySQL session row
        canSessionRepository.deleteBySessionId(sessionId);

        // 5. Clear in-memory integrity + requirement-engine + ML-dedup + correlation state
        //    (deleteSession also drops the persisted PASS-counter snapshot)
        integrityAnalyzerService.clearSession(sessionId);
        requirementMonitorService.deleteSession(sessionId);
        anomalyEventConsumer.clearSession(sessionId);
        findingCorrelationService.clearSession(sessionId);

        return new MysqlDeleteResult(faultCount, logFilename);
    }

    // ── Private ───────────────────────────────────────────────────────────────────

    private CanSessionResponse toSessionResponse(CanSessionEntity e) {
        int frameCount = e.getFrameCount() != null ? e.getFrameCount() : 0;
        if (frameCount == 0 && "COMPLETE".equals(e.getStatus())) {
            long influxCount = influxWriteService.countFrames(e.getSessionId(), null, null, null);
            if (influxCount > 0) {
                frameCount = (int) influxCount;
                // Persist the correction out-of-band — a GET request must not perform a
                // synchronous MySQL write. self is the @Lazy proxy so @Async actually applies.
                self.backfillFrameCountAsync(e.getSessionId(), frameCount);
            }
        }
        return new CanSessionResponse(
                e.getId(),
                e.getSessionId(),
                e.getSourceFilename(),
                e.getStartTs(),
                e.getEndTs(),
                frameCount,
                e.getCreatedAt(),
                e.getStatus()
        );
    }

    @org.springframework.scheduling.annotation.Async
    public void backfillFrameCountAsync(String sessionId, int frameCount) {
        canSessionRepository.findBySessionId(sessionId).ifPresent(entity -> {
            entity.setFrameCount(frameCount);
            canSessionRepository.save(entity);
        });
    }
}
