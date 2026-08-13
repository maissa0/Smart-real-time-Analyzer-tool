package com.example.backend.can.controller;

import com.example.backend.can.dto.CatalogInfoDto;
import com.example.backend.can.dto.DiagnosticReportDto;
import com.example.backend.can.dto.EnrichedFaultDto;
import com.example.backend.can.dto.FindingClusterDto;
import com.example.backend.can.dto.IntegritySummaryDto;
import com.example.backend.can.service.DiagnosticReportService;
import com.example.backend.can.service.IntegrityService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/can/integrity")
@RequiredArgsConstructor
public class IntegrityController {

    private final IntegrityService integrityService;
    private final DiagnosticReportService diagnosticReportService;

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/faults")
    public ResponseEntity<List<EnrichedFaultDto>> getFaults(@PathVariable String sessionId) {
        return ResponseEntity.ok(integrityService.getFaults(sessionId));
    }

    /** Phase-5 probable-root-cause clusters (2+ findings, same subsystem + window). */
    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/clusters")
    public ResponseEntity<List<FindingClusterDto>> getClusters(@PathVariable String sessionId) {
        return ResponseEntity.ok(integrityService.getClusters(sessionId));
    }

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/diagnostic-report")
    public ResponseEntity<DiagnosticReportDto> getDiagnosticReport(@PathVariable String sessionId) {
        return ResponseEntity.ok(diagnosticReportService.buildReport(sessionId));
    }

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/summary")
    public ResponseEntity<IntegritySummaryDto> getSummary(@PathVariable String sessionId) {
        return ResponseEntity.ok(integrityService.getSummary(sessionId));
    }

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/catalog")
    public ResponseEntity<CatalogInfoDto> getCatalog() {
        return ResponseEntity.ok(integrityService.getCatalogInfo());
    }
}
