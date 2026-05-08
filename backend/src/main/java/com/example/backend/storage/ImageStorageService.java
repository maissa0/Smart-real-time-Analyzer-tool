package com.example.backend.storage;

import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * Interface for image storage (avatars, etc.).
 * Implementations: LocalStorageServiceImpl (local disk) or S3StorageServiceImpl (AWS S3).
 */
public interface ImageStorageService {

    /**
     * Store an image and return the URL to access it.
     *
     * @param userId   User ID (for filename uniqueness)
     * @param file     Multipart file (must be image/*)
     * @return Public URL of the stored image
     */
    String storeImage(java.util.UUID userId, MultipartFile file) throws IOException;
}
