package com.molka.smart_analyzer_backend.kafka;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Kafka consumer for the async analysis pipeline.
 *
 * <p>The Python kafka worker (parser.py --kafka-worker) consumes jobs from
 * {@code file-processing-jobs}, processes CAN log files, and publishes results
 * back to Kafka keyed by {@code sessionId}.  This consumer picks those up and
 * forwards them to per-session WebSocket topics so the Angular client can
 * receive frames and progress events in real time.</p>
 *
 * <ul>
 *   <li>{@code can-frames-decoded}  → {@code /topic/async-frames/{sessionId}}</li>
 *   <li>{@code log-file-events}     → {@code /topic/async-progress/{sessionId}}</li>
 * </ul>
 *
 * <p>Messages without a key are ignored — they originate from the streaming
 * mode which sends frames directly to stdout, not via Kafka.</p>
 */
@Component
public class AsyncAnalysisConsumer {

    private static final Logger log = LoggerFactory.getLogger(AsyncAnalysisConsumer.class);

    @Autowired
    private SimpMessagingTemplate messaging;

    /**
     * Receives decoded CAN frames published by the Python kafka worker.
     * Each record is keyed by {@code sessionId}.
     */
    @KafkaListener(
        topics = "can-frames-decoded",
        groupId = "can-analyzer-async",
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void onDecodedFrame(ConsumerRecord<String, String> record) {
        String sessionId = record.key();
        if (sessionId == null || sessionId.isBlank()) {
            return; // not an async frame — produced without a key by streaming mode
        }
        try {
            messaging.convertAndSend("/topic/async-frames/" + sessionId, record.value());
        } catch (Exception e) {
            log.error("Error forwarding async frame for session {}: {}", sessionId, e.getMessage());
        }
    }

    /**
     * Receives progress and completion events from the Python kafka worker.
     * Each record is keyed by {@code sessionId}.
     * Expected event shapes:
     * <pre>
     *   {"event":"started",  "sessionId":"...", "sourceFilename":"..."}
     *   {"event":"progress", "sessionId":"...", "processed":N}
     *   {"event":"done",     "sessionId":"...", "frameCount":N, "errorReport":{...}}
     *   {"event":"error",    "sessionId":"...", "message":"..."}
     * </pre>
     */
    @KafkaListener(
        topics = "log-file-events",
        groupId = "can-analyzer-events",
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void onLogFileEvent(ConsumerRecord<String, String> record) {
        String sessionId = record.key();
        if (sessionId == null || sessionId.isBlank()) {
            return;
        }
        try {
            messaging.convertAndSend("/topic/async-progress/" + sessionId, record.value());
        } catch (Exception e) {
            log.error("Error forwarding progress event for session {}: {}", sessionId, e.getMessage());
        }
    }
}
