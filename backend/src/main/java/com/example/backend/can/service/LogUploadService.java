package com.example.backend.can.service;

import com.example.backend.can.config.KafkaTopicConfig;
import com.example.backend.can.dto.ProcessingJobPayload;
import com.example.backend.can.entity.LogFileEntity;
import com.example.backend.can.repository.LogFileRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.FileNotFoundException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class LogUploadService {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final LogFileRepository logFileRepository;
    private final CarService carService;

    @Value("${pipeline.uploads.dir}")
    private String uploadsDir;

    @Value("${pipeline.catalogues.dir}")
    private String cataloguesDir;

    /**
     * Saves the uploaded log file to disk and publishes a processing job to Kafka.
     * Returns the session ID immediately — processing happens asynchronously.
     */
    public String processUpload(MultipartFile file, String carUid) throws Exception {
        Path uploadPath = Paths.get(uploadsDir);
        Files.createDirectories(uploadPath);

        String originalName = file.getOriginalFilename() != null
                ? file.getOriginalFilename() : "upload.txt";
        String sessionId = UUID.randomUUID().toString();
        String savedName = sessionId + "_" + originalName;
        Path filePath = uploadPath.resolve(savedName);
        file.transferTo(filePath.toFile());
        log.info("Saved log file: {}", filePath);

        // Create LogFileEntity immediately so status endpoint returns data
        // before file_worker.py sends the metadata Kafka event
        LogFileEntity logFile = LogFileEntity.builder()
                .sessionId(sessionId)
                .filename(originalName)
                .fileSize(file.getSize())
                .status("PROCESSING")
                .build();
        logFileRepository.save(logFile);

        publishProcessingJob(sessionId, filePath, originalName, carUid);
        return sessionId;
    }

    private void publishProcessingJob(String sessionId, Path filePath,
            String sourceFilename, String carUid) throws Exception {
        // Scope decoding to the car's assigned catalogs (null = all catalogs)
        java.util.List<String> catalogFiles = null;
        if (carUid != null && !carUid.isBlank()) {
            java.util.List<String> assigned = carService.getAssignedCatalogFilenames(carUid);
            if (!assigned.isEmpty()) {
                catalogFiles = assigned;
            }
        }
        ProcessingJobPayload job = new ProcessingJobPayload(
                sessionId,
                filePath.toAbsolutePath().toString(),
                sourceFilename,
                cataloguesDir,
                (carUid != null && !carUid.isBlank()) ? carUid : null,
                catalogFiles
        );
        String jobJson = objectMapper.writeValueAsString(job);
        kafkaTemplate.send(KafkaTopicConfig.TOPIC_FILE_PROCESSING_JOBS, sessionId, jobJson);
        log.info("Published file processing job for session {}", sessionId);
    }

    /**
     * Retry by log file ID — looks up the record and delegates to retryProcessing.
     * Returns empty when no record exists for the given ID so the controller
     * can map to 404 without any repository access.
     */
    public Optional<Map<String, String>> retryById(Long logFileId) throws Exception {
        LogFileEntity logFile = logFileRepository.findById(logFileId).orElse(null);
        if (logFile == null) return Optional.empty();
        String sessionId = retryProcessing(logFile);
        return Optional.of(Map.of("sessionId", sessionId, "status", "PROCESSING"));
    }

    /**
     * Retry processing a previously failed log file.
     * Resets the status to processing and re-queues the file.
     * <p>
     * {@link LogFileEntity} does not store absolute path; the on-disk name matches
     * {@code processUpload}: {@code sessionId + "_" + originalFilename}.
     */
    public String retryProcessing(LogFileEntity logFile) throws Exception {
        logFile.setStatus("PROCESSING");
        logFileRepository.save(logFile);
        Path filePath = Paths.get(uploadsDir)
                .resolve(logFile.getSessionId() + "_" + logFile.getFilename());
        if (!Files.exists(filePath)) {
            throw new FileNotFoundException("File not found: " + filePath);
        }
        publishProcessingJob(logFile.getSessionId(), filePath, logFile.getFilename(), null);
        return logFile.getSessionId();
    }
}
