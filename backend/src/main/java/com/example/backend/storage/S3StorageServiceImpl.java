package com.example.backend.storage;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "app.storage.type", havingValue = "s3")
@Slf4j
public class S3StorageServiceImpl implements ImageStorageService {

    @Value("${app.storage.s3.bucket:able-pro-iam-avatars}")
    private String bucket;

    @Value("${app.storage.s3.region:us-east-1}")
    private String region;

    @Value("${app.storage.s3.prefix:avatars}")
    private String prefix;

    @Value("${app.storage.s3.public-url:}")
    private String publicUrlOverride;

    private final S3Client s3Client;

    public S3StorageServiceImpl(S3Client s3Client) {
        this.s3Client = s3Client;
    }

    @Override
    public String storeImage(UUID userId, MultipartFile file) throws IOException {
        ImageFileValidator.validate(file);
        String contentType = file.getContentType();
        String extension = getExtension(contentType);
        String key = prefix + "/" + userId + "_" + System.currentTimeMillis() + extension;

        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(contentType)
                .build();

        s3Client.putObject(request, RequestBody.fromInputStream(file.getInputStream(), file.getSize()));

        String url = buildPublicUrl(key);
        log.debug("Stored image in S3: {}", url);
        return url;
    }

    private String buildPublicUrl(String key) {
        if (publicUrlOverride != null && !publicUrlOverride.isBlank()) {
            return publicUrlOverride.endsWith("/") ? publicUrlOverride + key : publicUrlOverride + "/" + key;
        }
        return "https://" + bucket + ".s3." + region + ".amazonaws.com/" + key;
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
