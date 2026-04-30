package com.molka.smart_analyzer_backend.storage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

/**
 * Stores files on the local filesystem under {@code {repoRoot}/{baseDir}/{objectKey}}.
 * Active when {@code storage.type=local} (or not set).
 */
@Service
@ConditionalOnProperty(name = "storage.type", havingValue = "local", matchIfMissing = true)
public class LocalStorageServiceImpl implements StorageService {

	private static final Logger log = LoggerFactory.getLogger(LocalStorageServiceImpl.class);

	@Value("${storage.local.base-dir:uploads}")
	private String baseDir;

	@Override
	public String store(InputStream content, long size, String objectKey, String contentType) throws IOException {
		Path base   = resolveBaseDir();
		Path target = base.resolve(objectKey).normalize();
		if (!target.startsWith(base)) {
			throw new SecurityException("Path traversal detected for key: " + objectKey);
		}
		Files.createDirectories(target.getParent());
		Files.copy(content, target, StandardCopyOption.REPLACE_EXISTING);
		log.debug("Stored locally: {}", target);
		return objectKey;   // return the key, not the absolute path
	}

	/**
	 * Returns a relative API URL for serving the file.
	 * Handles both new-style object keys (e.g. {@code avatars/1_ts.jpg})
	 * and legacy absolute paths stored in the DB.
	 */
	@Override
	public String getPublicUrl(String address) {
		if (address == null) return null;
		try {
			Path p = Path.of(address);
			if (p.isAbsolute()) {
				// Legacy: absolute path written before StorageService was introduced
				return Files.exists(p) ? "/api/users/avatars/" + p.getFileName() : null;
			}
			// New: object key like "avatars/1_ts.jpg"
			Path full = resolveBaseDir().resolve(address);
			if (Files.exists(full)) {
				return "/api/users/avatars/" + Path.of(address).getFileName();
			}
			return null;
		} catch (Exception e) {
			log.warn("getPublicUrl failed for address '{}': {}", address, e.getMessage());
			return null;
		}
	}

	@Override
	public InputStream load(String address) throws IOException {
		Path p = Path.of(address);
		if (p.isAbsolute()) {
			return Files.newInputStream(p);
		}
		return Files.newInputStream(resolveBaseDir().resolve(address));
	}

	private Path resolveBaseDir() {
		Path backendRoot = Paths.get("").toAbsolutePath();
		Path repoRoot    = backendRoot.getParent() != null ? backendRoot.getParent() : backendRoot;
		return repoRoot.resolve(baseDir).toAbsolutePath().normalize();
	}
}
