package com.example.backend.can.controller;

import com.example.backend.can.dto.DiagnosticRuleDto;
import com.example.backend.can.entity.DiagnosticRuleEntity;
import com.example.backend.can.service.DiagnosticKbService;
import com.example.backend.exception.SafeErrorMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Rule read/create/update for the diagnostic knowledge base — consumed by the
 * inline fault editor. (The standalone diagnostics admin page and its
 * list/subsystems/delete endpoints were removed with it.)
 */
@RestController
@RequestMapping("/api/diagnostics")
@RequiredArgsConstructor
@Slf4j
public class DiagnosticKbController {

    private final DiagnosticKbService kbService;

    @PreAuthorize("hasAuthority('diagnostics:read') or hasRole('ADMIN')")
    @GetMapping("/rules/{id}")
    public ResponseEntity<DiagnosticRuleDto> getRule(@PathVariable Long id) {
        return kbService.getRule(id).map(DiagnosticRuleDto::from)
                .map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @PreAuthorize("hasAuthority('diagnostics:write') or hasRole('ADMIN')")
    @PostMapping("/rules")
    public ResponseEntity<?> createRule(@RequestBody DiagnosticRuleDto dto, Authentication auth) {
        try {
            DiagnosticRuleEntity saved = kbService.createRule(toEntity(dto), userName(auth));
            return ResponseEntity.ok(DiagnosticRuleDto.from(saved));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", SafeErrorMessage.of(e, "Invalid rule")));
        }
    }

    @PreAuthorize("hasAuthority('diagnostics:write') or hasRole('ADMIN')")
    @PutMapping("/rules/{id}")
    public ResponseEntity<?> updateRule(@PathVariable Long id, @RequestBody DiagnosticRuleDto dto, Authentication auth) {
        try {
            DiagnosticRuleEntity saved = kbService.updateRule(id, toEntity(dto), userName(auth));
            return ResponseEntity.ok(DiagnosticRuleDto.from(saved));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", SafeErrorMessage.of(e, "Invalid rule")));
        }
    }

    private static String userName(Authentication auth) {
        return auth != null ? auth.getName() : "unknown";
    }

    private static DiagnosticRuleEntity toEntity(DiagnosticRuleDto d) {
        return DiagnosticRuleEntity.builder()
                .scope(d.scope()).matchKey(d.matchKey()).faultType(emptyToNull(d.faultType()))
                .subsystem(d.subsystem()).title(d.title()).meaning(d.meaning())
                .likelyCause(d.likelyCause()).whatToCheck(d.whatToCheck())
                .severityWeight(d.severityWeight()).displayName(d.displayName())
                .enabled(d.enabled()).build();
    }

    private static String emptyToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
