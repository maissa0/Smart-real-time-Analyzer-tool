package com.example.backend.can.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class GroqClient {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Value("${groq.api-key}")
    private String apiKey;

    @Value("${groq.model:llama-3.3-70b-versatile}")
    private String model;

    private static final String API_URL = "https://api.groq.com/openai/v1/chat/completions";

    /** JSON-mode completion (schema-shaped output; prompt must mention "json"). */
    public String complete(String systemPrompt, String userMessage) {
        return complete(systemPrompt, userMessage, true);
    }

    /**
     * @param jsonMode true forces response_format json_object (Groq then requires
     *                 the word "json" in the messages); false returns plain text —
     *                 required for prose outputs like the session-compare analysis.
     */
    public String complete(String systemPrompt, String userMessage, boolean jsonMode) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("model", model);
        body.put("messages", List.of(
                Map.of("role", "system", "content", systemPrompt),
                Map.of("role", "user",   "content", userMessage)
        ));
        body.put("temperature", 0.1);
        body.put("max_tokens", 2048);
        if (jsonMode) {
            body.put("response_format", Map.of("type", "json_object"));
        }

        try {
            String payload = objectMapper.writeValueAsString(body);
            HttpEntity<String> entity = new HttpEntity<>(payload, headers);
            ResponseEntity<String> response = restTemplate.exchange(
                    API_URL, HttpMethod.POST, entity, String.class);

            JsonNode root = objectMapper.readTree(response.getBody());
            return root.path("choices").get(0)
                       .path("message").path("content").asText();
        } catch (Exception e) {
            log.error("Groq API call failed", e);
            throw new RuntimeException("LLM request failed: " + e.getMessage(), e);
        }
    }
}
