package com.molka.smart_analyzer_backend.controller;

import org.apache.kafka.clients.admin.AdminClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/health")
public class HealthController {

    private final AdminClient adminClient;

    public HealthController(AdminClient adminClient) {
        this.adminClient = adminClient;
    }

    /**
     * Probes Kafka by listing topic names with a 2-second timeout.
     * Always returns HTTP 200 — the body carries {"status":"up"} or {"status":"down"}
     * so Angular can distinguish availability without treating a 503 as a network error.
     */
    @GetMapping("/kafka")
    public ResponseEntity<Map<String, String>> kafkaHealth() {
        try {
            adminClient.listTopics().names().get(2, TimeUnit.SECONDS);
            return ResponseEntity.ok(Map.of("status", "up"));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("status", "down"));
        }
    }
}
