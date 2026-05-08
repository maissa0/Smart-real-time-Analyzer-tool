package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "integrity_faults")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IntegrityFaultEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private String sessionId;

    @Column(name = "frame_id")
    private Long frameId;

    @Column(name = "msg_id")
    private String msgId;

    @Column(name = "msg_name")
    private String msgName;

    @Column(name = "fault_type", nullable = false)
    private String faultType;

    @Column(name = "description", length = 500)
    private String description;

    @Column(name = "frame_timestamp")
    private Double frameTimestamp;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        this.createdAt = LocalDateTime.now();
    }
}
