package com.molka.smart_analyzer_backend.storage;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.io.InputStream;

/**
 * Stores files in a MinIO / S3-compatible bucket.
 * Active when {@code storage.type=s3}.
 */
@Service
@ConditionalOnProperty(name = "storage.type", havingValue = "s3")
public class S3StorageServiceImpl implements StorageService {

	private static final Logger log = LoggerFactory.getLogger(S3StorageServiceImpl.class);

	@Value("${storage.s3.bucket:can-analyzer}")
	private String bucket;

	@Value("${storage.s3.endpoint:http://localhost:9000}")
	private String endpoint;

	private final S3Client s3Client;

	public S3StorageServiceImpl(S3Client s3Client) {
		this.s3Client = s3Client;
	}

	@PostConstruct
	public void initBucket() {
		try {
			s3Client.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
			log.info("MinIO bucket '{}' already exists.", bucket);
		} catch (NoSuchBucketException e) {
			s3Client.createBucket(CreateBucketRequest.builder().bucket(bucket).build());
			log.info("Created MinIO bucket '{}'.", bucket);
		} catch (Exception e) {
			log.warn("Could not verify/create MinIO bucket '{}': {}", bucket, e.getMessage());
		}
	}

	@Override
	public String store(InputStream content, long size, String objectKey, String contentType) throws IOException {
		PutObjectRequest request = PutObjectRequest.builder()
				.bucket(bucket)
				.key(objectKey)
				.contentType(contentType)
				.build();
		s3Client.putObject(request, RequestBody.fromInputStream(content, size));
		log.debug("Stored in MinIO: {}/{}", bucket, objectKey);
		return objectKey;   // return key; URL is built separately via getPublicUrl()
	}

	/**
	 * Returns the full MinIO HTTP URL for the given object key.
	 * Browsers can access this URL directly when the bucket is public
	 * (or a presigned URL is needed for private buckets).
	 */
	@Override
	public String getPublicUrl(String objectKey) {
		if (objectKey == null) return null;
		String base = endpoint.endsWith("/") ? endpoint : endpoint + "/";
		return base + bucket + "/" + objectKey;
	}

	@Override
	public InputStream load(String objectKey) throws IOException {
		GetObjectRequest request = GetObjectRequest.builder()
				.bucket(bucket)
				.key(objectKey)
				.build();
		return s3Client.getObject(request);
	}
}
