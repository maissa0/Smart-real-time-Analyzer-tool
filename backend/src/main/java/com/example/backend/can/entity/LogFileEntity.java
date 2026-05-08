package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "log_files")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LogFileEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false, unique = true)
    private String sessionId;

    @Column(name = "filename", nullable = false)
    private String filename;

    @Column(name = "file_size")
    private Long fileSize;

    @Column(name = "format", length = 10)
    private String format;

    @Column(name = "channel_count")
    private Integer channelCount;

    @Column(name = "frame_count")
    private Integer frameCount;

    @Column(name = "start_ts")
    private Double startTs;

    @Column(name = "end_ts")
    private Double endTs;

    @Column(name = "duration_seconds")
    private Double durationSeconds;

    @Column(name = "status", length = 20)
    @Builder.Default
    private String status = "pending";

    @Column(name = "error_message", length = 500)
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;
}
