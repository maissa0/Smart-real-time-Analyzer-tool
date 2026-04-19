package com.molka.smart_analyzer_backend.kafka;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class AnomalyKafkaConsumer {

    private static final Logger log =
        LoggerFactory.getLogger(AnomalyKafkaConsumer.class);

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @KafkaListener(
        topics = "can-frames-anomalies",
        groupId = "can-analyzer-anomalies",
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void consume(ConsumerRecord<String, String> record) {
        try {
            String alertJson = record.value();
            log.warn("ANOMALY DETECTED: {}", alertJson);
            messagingTemplate.convertAndSend("/topic/anomalies", alertJson);
        } catch (Exception e) {
            log.error("Error processing anomaly alert: {}", e.getMessage());
        }
    }
}
