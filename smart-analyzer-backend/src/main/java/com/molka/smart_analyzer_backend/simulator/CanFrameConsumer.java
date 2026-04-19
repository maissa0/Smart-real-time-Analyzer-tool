package com.molka.smart_analyzer_backend.simulator;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Consumes CAN frames from the Kafka topic "can-frames-raw" and
 * forwards them to Angular clients over WebSocket /topic/frames.
 *
 * Pipeline: SimulationEngine → Kafka → CanFrameConsumer → WebSocket → Angular
 */
@Component
public class CanFrameConsumer {

	private static final Logger log = LoggerFactory.getLogger(CanFrameConsumer.class);

	private static final String WS_TOPIC = "/topic/frames";

	private final SimpMessagingTemplate messaging;
	private final ObjectMapper objectMapper;

	public CanFrameConsumer(SimpMessagingTemplate messaging, ObjectMapper objectMapper) {
		this.messaging = messaging;
		this.objectMapper = objectMapper;
		log.info("[CONSUMER] Bean constructor called");
	}

	@PostConstruct
	public void init() {
		log.info("[CONSUMER] CanFrameConsumer initialized — @KafkaListener should be active");
	}

	@KafkaListener(topics = "can-frames-raw", groupId = "can-analyzer")
	public void consume(String json) {
		SimulatorFrame frame;
		try {
			frame = objectMapper.readValue(json, SimulatorFrame.class);
		} catch (Exception e) {
			log.error("[CONSUMER] Failed to deserialize frame: {}", e.getMessage());
			return;
		}
		log.info("[CONSUMER] Received frame from Kafka: message={}, address={}", frame.message, frame.address);
		messaging.convertAndSend(WS_TOPIC, frame);
		log.info("[CONSUMER] Forwarded frame to WebSocket topic {}", WS_TOPIC);
	}
}
