package com.molka.smart_analyzer_backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "upload_records")
@Getter
@Setter
@NoArgsConstructor
public class UploadRecord {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(nullable = false)
	private String username;

	@Column(nullable = false)
	private String originalFilename;

	/** Object key (S3) or absolute path (local) returned by StorageService.store(). */
	@Column(nullable = false, length = 1000)
	private String storageAddress;

	@Column(nullable = false, updatable = false)
	private Instant uploadedAt;

	@Column
	private Integer frameCount;

	@PrePersist
	protected void onCreate() {
		if (uploadedAt == null) uploadedAt = Instant.now();
	}
}
