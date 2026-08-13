package com.example.backend.storage;

import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;

/**
 * Validates uploaded avatar images by their actual file-signature bytes, not just the
 * client-supplied Content-Type header — a header alone is trivially spoofable and doesn't
 * guarantee the bytes that follow are really an image.
 */
final class ImageFileValidator {

    private ImageFileValidator() {
    }

    static void validate(MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            throw new IllegalArgumentException("File is empty");
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            throw new IllegalArgumentException("File must be an image");
        }
        byte[] header = new byte[12];
        int read;
        try (InputStream in = file.getInputStream()) {
            read = in.readNBytes(header, 0, header.length);
        }
        if (read < 4 || !hasKnownImageSignature(header)) {
            throw new IllegalArgumentException("File content does not match a supported image format");
        }
    }

    private static boolean hasKnownImageSignature(byte[] h) {
        if ((h[0] & 0xFF) == 0xFF && (h[1] & 0xFF) == 0xD8 && (h[2] & 0xFF) == 0xFF) return true; // JPEG
        if ((h[0] & 0xFF) == 0x89 && h[1] == 'P' && h[2] == 'N' && h[3] == 'G') return true;       // PNG
        if (h[0] == 'G' && h[1] == 'I' && h[2] == 'F' && h[3] == '8') return true;                 // GIF
        return h.length >= 12 && h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F'
                && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P';                      // WEBP
    }
}
