package com.example.backend.storage;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "app.storage.type", havingValue = "local", matchIfMissing = true)
@Slf4j
public class LocalStorageServiceImpl implements ImageStorageService {

    @Value("${app.upload.dir:uploads/avatars}")
    private String uploadDir;

    @Value("${app.base-url}")
    private String baseUrl;

    @PostConstruct
    public void init() {
        try {
            Path uploadPath = Paths.get(uploadDir).toAbsolutePath();
            if (!Files.exists(uploadPath)) {
                Files.createDirectories(uploadPath);
                log.info("Created avatar upload directory: {}", uploadPath);
            }
        } catch (Exception e) {
            log.error("Failed to create upload directory: {}", e.getMessage());
        }
    }

    @Override
    public String storeImage(UUID userId, MultipartFile file) throws IOException {
        ImageFileValidator.validate(file);
        String extension = getExtension(file.getContentType());
        String filename = userId + "_" + System.currentTimeMillis() + extension;
        Path dir = Paths.get(uploadDir);
        Files.createDirectories(dir);
        Path target = dir.resolve(filename);
        file.transferTo(target.toFile());
        return baseUrl + "/uploads/avatars/" + filename;
    }

    private String getExtension(String contentType) {
        return switch (contentType) {
            case "image/jpeg", "image/jpg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/gif" -> ".gif";
            case "image/webp" -> ".webp";
            default -> ".jpg";
        };
    }
}
