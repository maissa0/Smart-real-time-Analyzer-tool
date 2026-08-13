package com.example.backend.can.controller;

import com.example.backend.can.dto.RequirementDtos.BatchRulesRequest;
import com.example.backend.can.dto.RequirementDtos.CreateRequest;
import com.example.backend.can.dto.RequirementDtos.MetaUpdateDto;
import com.example.backend.can.dto.RequirementDtos.NlConvertRequest;
import com.example.backend.can.dto.RequirementDtos.RequirementReportDto;
import com.example.backend.can.dto.RequirementDtos.RuleEditDto;
import com.example.backend.can.dto.RequirementDtos.SourceDto;
import com.example.backend.can.dto.RequirementDtos.SummaryDto;
import com.example.backend.can.service.RequirementMonitorService;
import com.example.backend.can.service.RequirementNlService;
import com.example.backend.can.service.RequirementService;
import com.example.backend.exception.SafeErrorMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * Requirement-set endpoints (mirror of CatalogController for the dynamic,
 * per-car requirement YAML files). Guarded by the requirement:read/write
 * authorities seeded in DataInitializer.
 */
@RestController
@RequestMapping("/api/requirements")
@RequiredArgsConstructor
@Slf4j
public class RequirementController {

    private final RequirementService requirementService;
    private final RequirementMonitorService requirementMonitorService;
    private final RequirementNlService requirementNlService;

    @PreAuthorize("hasAuthority('requirement:read') or hasRole('ADMIN')")
    @GetMapping
    public ResponseEntity<List<SummaryDto>> listRequirementSets() {
        return ResponseEntity.ok(requirementService.listSets());
    }

    /**
     * Session requirements report (plan §2.3): per-rule outcome + coverage
     * counts + summary. Live from the engine while the session runs; rebuilt
     * from persisted findings once the session completed.
     */
    @PreAuthorize("hasAuthority('requirement:read') or hasRole('ADMIN')")
    @GetMapping("/sessions/{sessionId}/report")
    public ResponseEntity<RequirementReportDto> getSessionReport(@PathVariable String sessionId) {
        RequirementReportDto report = requirementMonitorService.report(sessionId);
        return report == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(report);
    }

    @PreAuthorize("hasAuthority('requirement:read') or hasRole('ADMIN')")
    @GetMapping("/{filename}")
    public ResponseEntity<?> getRequirementSet(@PathVariable String filename) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        return requirementService.getParsed(filename)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PreAuthorize("hasAuthority('requirement:read') or hasRole('ADMIN')")
    @GetMapping("/{filename}/source")
    public ResponseEntity<?> getRequirementSource(@PathVariable String filename) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        try {
            return ResponseEntity.ok(new SourceDto(filename, requirementService.readSource(filename)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Failed to read requirement source {}: {}", filename, e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to read requirement source")));
        }
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PutMapping("/{filename}/source")
    public ResponseEntity<?> saveRequirementSource(
            @PathVariable String filename,
            @RequestBody SourceDto body) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        if (body == null || body.yaml() == null || body.yaml().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "YAML content is required"));
        }
        try {
            return ResponseEntity.ok(requirementService.saveSource(filename, body.yaml()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to save requirement source {}: {}", filename, e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to save requirement source")));
        }
    }

    // ── Structured editing (Phase A, docs/REQUIREMENTS_AUTHORING_PLAN.md) ─────

    /**
     * Signals in scope for this file's rules (catalog signals of the assigned
     * cars); {@code ?carUid=} scopes to one car for the car-page builder.
     */
    @PreAuthorize("hasAuthority('requirement:read') or hasRole('ADMIN')")
    @GetMapping("/{filename}/signal-context")
    public ResponseEntity<?> getSignalContext(
            @PathVariable String filename,
            @RequestParam(required = false) String carUid) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(requirementService.signalContext(filename, carUid));
    }

    /**
     * Natural language -> structured rule preview (Phase C). Nothing is saved;
     * the client shows the draft in the structured form and saves via the
     * Phase A endpoints. Engine = LLM (Groq) or PARSER (local EN/FR fallback).
     */
    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PostMapping("/nl-convert")
    public ResponseEntity<?> nlConvert(@RequestBody NlConvertRequest body) {
        try {
            return ResponseEntity.ok(requirementNlService.convert(body));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("nl-convert failed: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Conversion failed")));
        }
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PostMapping("/create")
    public ResponseEntity<?> createRequirementSet(@RequestBody CreateRequest body) {
        if (body == null || !isSafeYamlFilename(body.filename())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "A safe .yaml/.yml filename is required"));
        }
        return mutation(body.filename(), "create",
                () -> requirementService.createFile(body));
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PostMapping("/{filename}/rules")
    public ResponseEntity<?> addRule(@PathVariable String filename, @RequestBody RuleEditDto body) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        return mutation(filename, "add rule", () -> requirementService.addRule(filename, body));
    }

    /** Append several accepted drafts in one write (bulk review, Phase D). */
    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PostMapping("/{filename}/rules/batch")
    public ResponseEntity<?> addRulesBatch(
            @PathVariable String filename, @RequestBody BatchRulesRequest body) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        return mutation(filename, "add rules",
                () -> requirementService.addRules(filename, body == null ? null : body.rules()));
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PutMapping("/{filename}/rules/{ruleId}")
    public ResponseEntity<?> updateRule(
            @PathVariable String filename,
            @PathVariable String ruleId,
            @RequestBody RuleEditDto body) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        return mutation(filename, "update rule",
                () -> requirementService.updateRule(filename, ruleId, body));
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @DeleteMapping("/{filename}/rules/{ruleId}")
    public ResponseEntity<?> deleteRule(@PathVariable String filename, @PathVariable String ruleId) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        return mutation(filename, "delete rule",
                () -> requirementService.deleteRule(filename, ruleId));
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PutMapping("/{filename}/meta")
    public ResponseEntity<?> updateMeta(@PathVariable String filename, @RequestBody MetaUpdateDto body) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        return mutation(filename, "update meta",
                () -> requirementService.updateMeta(filename, body));
    }

    /** Shared error mapping for the structured-mutation endpoints. */
    private ResponseEntity<?> mutation(String filename, String what, MutationCall call) {
        try {
            return ResponseEntity.ok(call.run());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to {} on {}: {}", what, filename, e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to " + what)));
        }
    }

    @FunctionalInterface
    private interface MutationCall {
        SummaryDto run() throws Exception;
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PostMapping("/upload")
    public ResponseEntity<?> uploadRequirementSet(@RequestParam("file") MultipartFile file) {
        String originalName = file.getOriginalFilename();
        if (originalName == null || !isSafeYamlFilename(originalName)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Only .yaml/.yml files with a safe filename are accepted"));
        }
        try {
            return ResponseEntity.ok(requirementService.upload(file));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to upload requirement set {}: {}", originalName, e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to upload requirement set")));
        }
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @DeleteMapping("/{filename}")
    public ResponseEntity<?> deleteRequirementSet(@PathVariable String filename) {
        if (!isSafeYamlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        try {
            requirementService.delete(filename);
            return ResponseEntity.ok(Map.of("filename", filename, "status", "deleted"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Failed to delete requirement set {}: {}", filename, e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to delete requirement set")));
        }
    }

    @PreAuthorize("hasAuthority('requirement:write') or hasRole('ADMIN')")
    @PostMapping("/reload")
    public ResponseEntity<List<SummaryDto>> reload() {
        return ResponseEntity.ok(requirementService.reload());
    }

    /** Bare .yaml/.yml filename — no path separators, no traversal, no hidden files. */
    private boolean isSafeYamlFilename(String filename) {
        return filename != null
                && filename.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,250}\\.(yaml|yml)")
                && !filename.contains("..");
    }
}
