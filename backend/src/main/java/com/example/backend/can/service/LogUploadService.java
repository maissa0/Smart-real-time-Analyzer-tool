package com.example.backend.can.service;

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
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class LogUploadService {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final LogFileRepository logFileRepository;

    @Value("${pipeline.uploads.dir}")
    private String uploadsDir;

    @Value("${pipeline.catalogues.dir}")
    private String cataloguesDir;

    /**
     * Saves the uploaded log file to disk and publishes a processing job to Kafka.
     * Returns the session ID immediately — processing happens asynchronously.
     */
    public String processUpload(MultipartFile file) throws Exception {
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

        publishProcessingJob(sessionId, filePath, originalName);
        return sessionId;
    }

    private void publishProcessingJob(String sessionId, Path filePath, String sourceFilename) throws Exception {
        Map<String, String> job = Map.of(
                "session_id", sessionId,
                "file_path", filePath.toAbsolutePath().toString(),
                "source_filename", sourceFilename,
                "catalogues_dir", cataloguesDir
        );
        String jobJson = objectMapper.writeValueAsString(job);
        kafkaTemplate.send("file-processing-jobs", sessionId, jobJson);
        log.info("Published file processing job for session {}", sessionId);
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
        publishProcessingJob(logFile.getSessionId(), filePath, logFile.getFilename());
        return logFile.getSessionId();
    }
}
