package com.example.backend.can.controller;

import com.example.backend.can.dto.NlQueryRequest;
import com.example.backend.can.dto.NlQueryResponse;
import com.example.backend.can.service.NlQueryService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/nl-query")
@RequiredArgsConstructor
@Slf4j
public class NlQueryController {

    private final NlQueryService nlQueryService;

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @PostMapping
    public ResponseEntity<?> query(@Valid @RequestBody NlQueryRequest request) {
        try {
            NlQueryResponse response = nlQueryService.execute(request);
            return ResponseEntity.ok(response);
        } catch (SecurityException e) {
            log.warn("NL query rejected by safety check: {}", e.getMessage());
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Query rejected: " + e.getMessage()));
        } catch (IllegalStateException e) {
            log.warn("NL query LLM error: {}", e.getMessage());
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("NL query execution failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Query execution failed. Please try rephrasing your question."));
        }
    }
}
