package com.example.backend.can.kafka;

import com.example.backend.can.config.KafkaTopicConfig;
import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.service.AnalysisExecutorService;
import com.example.backend.can.service.CanSessionService;
import com.example.backend.can.service.InfluxWriteService;
import com.example.backend.can.service.IntegrityAnalyzerService;
import com.example.backend.can.service.LogFileService;
import com.example.backend.can.service.RequirementMonitorService;
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
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
@Slf4j
public class CanKafkaConsumer {

    private final CanSessionService canSessionService;
    private final InfluxWriteService influxWriteService;
    private final IntegrityAnalyzerService integrityAnalyzerService;
    private final RequirementMonitorService requirementMonitorService;
    private final AnalysisExecutorService analysisExecutorService;
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
                .doOnError(e -> log.error("Broadcaster pipeline error: ", e))
                .subscribe(batch -> {
                    try {
                        batch.stream()
                                .collect(Collectors.groupingBy(CanFrameEntity::getSessionId))
                                .forEach((sessionId, frames) -> {
                                    String shortId = sessionId != null && sessionId.length() >= 8
                                            ? sessionId.substring(0, 8) : sessionId;
                                    log.debug("[WS] broadcasting {} frames to /topic/frames/{}",
                                        frames.size(), shortId);
                                    messagingTemplate.convertAndSend(
                                            "/topic/frames/" + sessionId, frames);
                                });
                        messagingTemplate.convertAndSend("/topic/live-telemetry", batch);
                        log.debug("[WS] batch broadcast complete: {} total frames", batch.size());
                    } catch (Exception e) {
                        log.error("Broadcaster batch error for {} frames: ", batch.size(), e);
                    }
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

    @KafkaListener(topics = KafkaTopicConfig.TOPIC_SESSION_META, groupId = "${spring.kafka.consumer.group-id}")
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

    @KafkaListener(topics = KafkaTopicConfig.TOPIC_LOG_FILE_EVENTS, groupId = "${spring.kafka.consumer.group-id}")
    public void consumeLogFileEvent(String message, Acknowledgment ack) {
        try {
            logFileService.saveLogFileEvent(message);
            ack.acknowledge();
        } catch (Exception e) {
            log.error("Failed to process log-file-events message", e);
            // Do not acknowledge — message will be redelivered
        }
    }

    @KafkaListener(topics = KafkaTopicConfig.TOPIC_DECODED_SIGNALS, groupId = "${spring.kafka.consumer.group-id}")
    public void consumeDecodedFrame(ConsumerRecord<String, String> record, Acknowledgment ack) {
        try {
            String enrichedJson = mergeSessionKeyIntoJson(record.value(), record.key());
            JsonNode enrichedRoot = objectMapper.readTree(enrichedJson);
            String signalsJson = enrichedRoot.has("signals")
                    ? enrichedRoot.get("signals").toString() : "[]";

            // Build a transient in-memory entity — no MySQL save.
            // Frames are persisted exclusively to InfluxDB (can_frames measurement).
            CanFrameEntity frame = canSessionService.buildTransientFrame(enrichedJson);
            if (frame != null) {
                String shortSessionId = frame.getSessionId() != null && frame.getSessionId().length() >= 8
                        ? frame.getSessionId().substring(0, 8) : frame.getSessionId();
                log.debug("[BACKEND] frame built: session={} msg={} ts={}",
                    shortSessionId, frame.getMsgId(), frame.getTimestamp());

                // Resolve startTs once on the consumer thread so writeFrame is a pure function.
                double sessionStartTs = influxWriteService.getSessionStartTs(frame.getSessionId());

                CompletableFuture.runAsync(() -> {
                    try {
                        influxWriteService.writeFrame(frame, signalsJson, sessionStartTs);
                    } catch (Exception e) {
                        log.error("InfluxDB write failed for frame session={}", frame.getSessionId(), e);
                    }
                });
                // Ordered per-session lane — integrity checks compare each frame
                // against the previous one, so same-session frames must never be
                // analyzed concurrently or out of order. The requirements engine
                // shares the same lane task: same thread, Kafka order, right
                // after the integrity pass (isolated failure domains).
                analysisExecutorService.submit(frame.getSessionId(), () -> {
                    try {
                        integrityAnalyzerService.analyze(frame, signalsJson, sessionStartTs);
                    } catch (Exception e) {
                        log.error("Integrity analysis failed for frame session={}", frame.getSessionId(), e);
                    }
                    try {
                        requirementMonitorService.onFrame(frame, signalsJson, sessionStartTs);
                    } catch (Exception e) {
                        log.error("Requirement analysis failed for frame session={}", frame.getSessionId(), e);
                    }
                });

                frame.setSignals(signalsJson);
                Sinks.EmitResult emitResult = frameSink.tryEmitNext(frame);
                if (emitResult == Sinks.EmitResult.FAIL_OVERFLOW) {
                    log.warn("Broadcaster buffer full, dropping frame for session: {}",
                        frame.getSessionId());
                } else {
                    log.debug("[BACKEND] frame emitted to WebSocket sink: session={}", shortSessionId);
                }
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
