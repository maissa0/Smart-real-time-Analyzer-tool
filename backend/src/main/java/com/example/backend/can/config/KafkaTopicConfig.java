package com.example.backend.can.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.common.config.TopicConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

@Configuration
public class KafkaTopicConfig {

    // 7 days retention for session metadata and decoded frames (historical reference)
    private static final String RETENTION_7_DAYS = String.valueOf(168L * 60 * 60 * 1000);

    // 1 hour retention for raw and decoded signal pipeline topics
    // MySQL/InfluxDB are the permanent store — Kafka only needs short retention here
    private static final String RETENTION_1_HOUR = String.valueOf(60L * 60 * 1000);

    @Bean
    public NewTopic sessionMetaTopic() {
        return TopicBuilder.name("session-meta")
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
        return TopicBuilder.name("raw-can-frames")
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_1_HOUR)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic decodedSignalsTopic() {
        return TopicBuilder.name("decoded-signals")
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_1_HOUR)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic fileProcessingJobsTopic() {
        return TopicBuilder.name("file-processing-jobs")
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_7_DAYS)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }

    @Bean
    public NewTopic logFileEventsTopic() {
        return TopicBuilder.name("log-file-events")
                .partitions(1)
                .replicas(1)
                .config(TopicConfig.RETENTION_MS_CONFIG, RETENTION_7_DAYS)
                .config(TopicConfig.CLEANUP_POLICY_CONFIG, TopicConfig.CLEANUP_POLICY_DELETE)
                .build();
    }
}
