package com.example.backend.can.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.common.config.TopicConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

@Configuration
public class KafkaTopicConfig {

    // ── Topic name constants — single source of truth ─────────────────────────
    // Reference these in @KafkaListener(topics = ...) and kafkaTemplate.send()
    // so the topic name is never repeated as a string literal.
    public static final String TOPIC_SESSION_META        = "session-meta";
    public static final String TOPIC_RAW_CAN_FRAMES      = "raw-can-frames";
    public static final String TOPIC_DECODED_SIGNALS     = "decoded-signals";
    public static final String TOPIC_FILE_PROCESSING_JOBS = "file-processing-jobs";
    public static final String TOPIC_LOG_FILE_EVENTS     = "log-file-events";
    public static final String TOPIC_ANOMALY_EVENTS      = "anomaly-events";
    /** Backend → anomaly engine: session finished, clean or not (Phase 4 baselines). */
    public static final String TOPIC_SESSION_CLEAN       = "session-clean-events";

    // 7 days retention for session metadata and decoded frames (historical reference)
    private static final String RETENTION_7_DAYS = String.valueOf(168L * 60 * 60 * 1000);

    // 1 hour retention for raw and decoded signal pipeline topics
    // MySQL/InfluxDB are the permanent store — Kafka only needs short retention here
    private static final String RETENTION_1_HOUR = String.valueOf(60L * 60 * 1000);

    @Bean
    public NewTopic sessionMetaTopic() {
        return TopicBuilder.name(TOPIC_SESSION_META)
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_7_DAYS)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic decodedFramesTopic() {
        return TopicBuilder.name("decoded-frames")
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_7_DAYS)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic rawCanFramesTopic() {
        return TopicBuilder.name(TOPIC_RAW_CAN_FRAMES)
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_1_HOUR)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic decodedSignalsTopic() {
        return TopicBuilder.name(TOPIC_DECODED_SIGNALS)
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_1_HOUR)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic fileProcessingJobsTopic() {
        return TopicBuilder.name(TOPIC_FILE_PROCESSING_JOBS)
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_7_DAYS)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic logFileEventsTopic() {
        return TopicBuilder.name(TOPIC_LOG_FILE_EVENTS)
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_7_DAYS)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic sessionCleanTopic() {
        return TopicBuilder.name(TOPIC_SESSION_CLEAN)
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_7_DAYS)
                .build();
    }

    @Bean
    public NewTopic anomalyEventsTopic() {
        return TopicBuilder.name(TOPIC_ANOMALY_EVENTS)
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_1_HOUR)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }
}
