package com.molka.smart_analyzer_backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

import java.net.URI;

/**
 * AWS SDK S3 client configured for MinIO (path-style access required).
 * Only active when {@code storage.type=s3}.
 */
@Configuration
@ConditionalOnProperty(name = "storage.type", havingValue = "s3")
public class S3Config {

	@Value("${storage.s3.region:us-east-1}")
	private String region;

	@Value("${storage.s3.access-key:}")
	private String accessKey;

	@Value("${storage.s3.secret-key:}")
	private String secretKey;

	@Value("${storage.s3.endpoint:}")
	private String endpoint;

	@Bean
	public S3Client s3Client() {
		var builder = S3Client.builder()
				.region(Region.of(region))
				// MinIO requires path-style access (not virtual-hosted)
				.serviceConfiguration(S3Configuration.builder()
						.pathStyleAccessEnabled(true)
						.build());

		if (accessKey != null && !accessKey.isBlank()
				&& secretKey != null && !secretKey.isBlank()) {
			builder.credentialsProvider(StaticCredentialsProvider.create(
					AwsBasicCredentials.create(accessKey, secretKey)));
		}

		if (endpoint != null && !endpoint.isBlank()) {
			builder.endpointOverride(URI.create(endpoint));
		}

		return builder.build();
	}
}
