package com.molka.smart_analyzer_backend.storage;

import java.io.IOException;
import java.io.InputStream;

/**
 * Abstraction over file storage (local disk or S3-compatible object store).
 */
public interface StorageService {

	/**
	 * Stores content at the given objectKey.
	 *
	 * @return the storage address used to retrieve the object later
	 *         (object key for S3, absolute path for local)
	 */
	String store(InputStream content, long size, String objectKey, String contentType) throws IOException;

	/**
	 * Returns a URL that a browser can use to view/download the stored object.
	 * For S3: full MinIO HTTP URL.
	 * For local: relative API URL like {@code /api/users/avatars/filename}.
	 */
	String getPublicUrl(String address);

	/**
	 * Downloads and returns the stored content by its address.
	 */
	InputStream load(String address) throws IOException;
}
