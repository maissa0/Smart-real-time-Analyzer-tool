package com.example.backend.can.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

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

    @Value("${pipeline.uploads.dir}")
    private String uploadsDir;

    @Value("${pipeline.catalogues.dir}")
    private String cataloguesDir;

    /**
     * Saves the uploaded log file to disk and publishes a processing job to Kafka.
     * Returns the session ID immediately — processing happens asynchronously.
     */
    public String processUpload(MultipartFile file) throws Exception {
        // Save file to disk
        Path uploadPath = Paths.get(uploadsDir);
        Files.createDirectories(uploadPath);

        String originalName = file.getOriginalFilename() != null
                ? file.getOriginalFilename() : "upload.txt";
        String sessionId = UUID.randomUUID().toString();
        String savedName = sessionId + "_" + originalName;
        Path filePath = uploadPath.resolve(savedName);
        file.transferTo(filePath.toFile());
        log.info("Saved log file: {}", filePath);

        // Publish processing job to Kafka
        Map<String, String> job = Map.of(
                "session_id", sessionId,
                "file_path", filePath.toAbsolutePath().toString(),
                "source_filename", originalName,
                "catalogues_dir", cataloguesDir
        );

        String jobJson = objectMapper.writeValueAsString(job);
        kafkaTemplate.send("file-processing-jobs", sessionId, jobJson);
        log.info("Published file processing job for session {}", sessionId);

        return sessionId;
    }
}
