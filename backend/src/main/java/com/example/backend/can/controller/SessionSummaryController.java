package com.example.backend.can.controller;

import com.example.backend.can.dto.SessionSummaryDto;
import com.example.backend.can.service.SessionSummaryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sessions")
@RequiredArgsConstructor
public class SessionSummaryController {

    private final SessionSummaryService summaryService;

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/{sessionId}/summary")
    public ResponseEntity<SessionSummaryDto> get(@PathVariable String sessionId) {
        return summaryService.findBySessionId(sessionId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @PostMapping("/{sessionId}/summary/generate")
    public ResponseEntity<Void> generate(@PathVariable String sessionId) {
        summaryService.generateAsync(sessionId);
        return ResponseEntity.accepted().build();
    }
}
