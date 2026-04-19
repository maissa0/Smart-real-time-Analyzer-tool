package com.molka.smart_analyzer_backend.kafka;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class DecodedFrameKafkaConsumer {

    private static final Logger log =
        LoggerFactory.getLogger(DecodedFrameKafkaConsumer.class);

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @KafkaListener(
        topics = "can-frames-decoded",
        groupId = "can-analyzer-decoded",
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void consume(ConsumerRecord<String, String> record) {
        try {
            String frameJson = record.value();
            log.debug("Received decoded frame from Kafka: {}", frameJson);
            // Forward to WebSocket subscribers (same topic Angular already
            // listens to)
            messagingTemplate.convertAndSend("/topic/frames", frameJson);
        } catch (Exception e) {
            log.error("Error processing decoded frame from Kafka: {}",
                e.getMessage());
        }
    }
}
