package com.example.backend.can.controller;

import com.example.backend.can.dto.FullReportDto;
import com.example.backend.can.service.FullReportService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The unified session report: one endpoint composing verdict, requirements,
 * integrity findings, clusters, diagnostics, AI summary and vehicle context.
 * Rendered by the Report tab and printed verbatim by both PDF export paths.
 */
@RestController
@RequestMapping("/api/can/sessions")
@RequiredArgsConstructor
public class FullReportController {

    private final FullReportService fullReportService;

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/{sessionId}/full-report")
    public ResponseEntity<FullReportDto> getFullReport(@PathVariable String sessionId) {
        return ResponseEntity.ok(fullReportService.buildReport(sessionId));
    }
}
