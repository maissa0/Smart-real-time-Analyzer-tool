package com.example.backend.can.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Entity
@Table(name = "session_summaries")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SessionSummary {

    @Id
    private String sessionId;

    @Column(columnDefinition = "LONGTEXT", nullable = false)
    private String reportText;

    private String modelUsed;
    private Integer signalCount;
    private Integer errorCount;

    @Column(nullable = false)
    private Instant generatedAt;
}