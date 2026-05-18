package com.example.backend.can.kafka;

import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.service.CanSessionService;
import com.example.backend.can.service.InfluxWriteService;
import com.example.backend.can.service.IntegrityAnalyzerService;
import com.example.backend.can.service.LogFileService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.List;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
@Slf4j
public class CanKafkaConsumer {

    private final CanSessionService canSessionService;
    private final InfluxWriteService influxWriteService;
    private final IntegrityAnalyzerService integrityAnalyzerService;
    private final LogFileService logFileService;
    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    // 60Hz batch sink — buffers frames and broadcasts every 16ms
    private final Sinks.Many<CanFrameEntity> frameSink =
            Sinks.many().multicast().onBackpressureBuffer(1000);
    private Disposable batchSubscription;

    @PostConstruct
    public void startBatchBroadcaster() {
        batchSubscription = frameSink.asFlux()
                .buffer(Duration.ofMillis(16))
                .filter(batch -> !batch.isEmpty())
                .subscribe(batch -> {
                    // Broadcast batch to session-specific topics
                    // Group by sessionId so each session gets its own batch
                    batch.stream()
                            .collect(Collectors.groupingBy(CanFrameEntity::getSessionId))
                            .forEach((sessionId, frames) -> {
                                log.info("[WS] broadcasting {} frames to /topic/frames/{}",
                                    frames.size(), sessionId.substring(0, 8));
                                messagingTemplate.convertAndSend(
                                        "/topic/frames/" + sessionId, frames);
                            });
                    // Global broadcast — full batch to live-telemetry
                    messagingTemplate.convertAndSend("/topic/live-telemetry", batch);
                    log.info("[WS] batch broadcast complete: {} total frames", batch.size());
                });
        log.info("60Hz batch broadcaster started");
    }

    @PreDestroy
    public void stopBatchBroadcaster() {
        if (batchSubscription != null && !batchSubscription.isDisposed()) {
            batchSubscription.dispose();
        }
        log.info("60Hz batch broadcaster stopped");
    }

    @KafkaListener(topics = "session-meta", groupId = "kpit-backend")
    public void consumeSessionMeta(String message, Acknowledgment ack) {
        try {
            canSessionService.saveSession(message);
            log.info("[BACKEND] Session meta saved: {}", message);
            messagingTemplate.convertAndSend("/topic/sessions", message);
            ack.acknowledge();
        } catch (Exception e) {
            log.error("Failed to process session-meta message", e);
            // Do not acknowledge — message will be redelivered
        }
    }

    @KafkaListener(topics = "log-file-events", groupId = "kpit-backend")
    public void consumeLogFileEvent(String message, Acknowledgment ack) {
        try {
            logFileService.saveLogFileEvent(message);
            ack.acknowledge();
        } catch (Exception e) {
            log.error("Failed to process log-file-events message", e);
            // Do not acknowledge — message will be redelivered
        }
    }

    @KafkaListener(topics = "decoded-signals", groupId = "kpit-backend")
    public void consumeDecodedFrame(ConsumerRecord<String, String> record, Acknowledgment ack) {
        try {
            String enrichedJson = mergeSessionKeyIntoJson(record.value(), record.key());
            CanFrameEntity savedFrame = canSessionService.saveFrame(enrichedJson);
            if (savedFrame != null) {
                log.info("[BACKEND] frame saved: id={} session={} msg={} ts={}",
                    savedFrame.getId(),
                    savedFrame.getSessionId() != null ? savedFrame.getSessionId().substring(0, 8) : "null",
                    savedFrame.getMsgId(),
                    savedFrame.getTimestamp());
                influxWriteService.writeFrame(savedFrame);
                integrityAnalyzerService.analyze(savedFrame);
                frameSink.tryEmitNext(savedFrame);
                log.info("[BACKEND] frame emitted to WebSocket sink: id={}", savedFrame.getId());
            }
            ack.acknowledge();
        } catch (Exception e) {
            log.error("Failed to process decoded-signals message", e);
            // Do not acknowledge — message will be redelivered
        }
    }

    private String mergeSessionKeyIntoJson(String json, String sessionKey) throws JsonProcessingException {
        JsonNode root = objectMapper.readTree(json);
        if (!(root instanceof ObjectNode objectNode)) {
            return json;
        }
        if (sessionKey != null && (!objectNode.has("session_id") || objectNode.get("session_id").isNull())) {
            objectNode.put("session_id", sessionKey);
        }
        // Convert signals from decoded-signals format { name: {raw_value, label} }
        // to flat array format [ {signal_name, raw_value, label} ] for CanFrameEntity
        JsonNode signalsNode = objectNode.get("signals");
        if (signalsNode != null && signalsNode.isObject()) {
            var signalsArray = objectMapper.createArrayNode();
            signalsNode.fields().forEachRemaining(entry -> {
                var sigObj = objectMapper.createObjectNode();
                sigObj.put("signal_name", entry.getKey());
                sigObj.put("raw_value", entry.getValue().path("raw_value").asInt());
                sigObj.put("label", entry.getValue().path("label").asText());
                signalsArray.add(sigObj);
            });
            objectNode.set("signals", signalsArray);
        }
        return objectMapper.writeValueAsString(objectNode);
    }
}
