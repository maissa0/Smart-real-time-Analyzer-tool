package com.molka.smart_analyzer_backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "frames")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Frame {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(nullable = false)
	private Double timestamp;

	@Column(nullable = false)
	private String address;

	@Column(nullable = false)
	private String bus;

	@Column(nullable = false)
	private String message;

	@Column(nullable = false)
	private String direction;

	@Lob
	@Column(nullable = false, columnDefinition = "LONGTEXT")
	private String rawData;

	@Lob
	@Column(nullable = false, columnDefinition = "LONGTEXT")
	private String signals;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	@PrePersist
	protected void onCreate() {
		if (createdAt == null) {
			createdAt = Instant.now();
		}
	}
}

