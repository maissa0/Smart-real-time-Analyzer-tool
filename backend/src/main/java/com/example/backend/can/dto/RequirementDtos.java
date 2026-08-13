package com.example.backend.can.dto;

import java.util.List;
import java.util.Map;

/** API payloads for the requirement-set endpoints (mirror of the catalog DTOs). */
public final class RequirementDtos {

    private RequirementDtos() {
    }

    // ── Structured editing (Phase A, docs/REQUIREMENTS_AUTHORING_PLAN.md) ─────

    /** A signal transition edge ({@code from} and/or {@code to}). */
    public record EdgeDto(String signal, String from, String to) {}

    /** Expected outcome: {@code signal} must become {@code becomes}. */
    public record ExpectDto(String signal, String becomes) {}

    /**
     * One rule as edited in the structured UI. Predicates are the raw
     * predicate strings of the tiny predicate language (validated server-side
     * by re-parsing the whole file before anything touches disk).
     */
    public record RuleEditDto(
            String id,
            String title,
            String component,
            String severity,
            String kind,
            boolean draft,
            List<String> preconditions,
            List<String> whileConds,
            EdgeDto trigger,
            EdgeDto forbidden,
            ExpectDto expect,
            List<String> expectAll,
            Long deadlineMs,
            Long durationMs,
            Long windowMs,
            Double tolerancePct,
            String stateSignal,
            List<List<String>> allowedTransitions,
            String violationTitle,
            List<String> checkList) {}

    /** One derived-signal case: {@code value} when all {@code when} predicates hold. */
    public record DerivedCaseEditDto(String value, List<String> when) {}

    /** One derived signal as edited in the meta section. */
    public record DerivedSignalEditDto(String name, List<String> from, List<DerivedCaseEditDto> cases) {}

    /** Meta-section update: display name, version, signal_map, derived_signals. */
    public record MetaUpdateDto(
            String name,
            String version,
            Map<String, String> signalMap,
            List<DerivedSignalEditDto> derivedSignals) {}

    /** Create-new-file request; {@code carUid} optionally assigns it to a car. */
    public record CreateRequest(String filename, String name, String carUid) {}

    /** One catalog signal available to a requirement file's rules. */
    public record SignalOptionDto(String name, String message, String catalog, List<String> labels) {}

    // ── Natural-language conversion (Phase C) ─────────────────────────────────

    /** Request for POST /api/requirements/nl-convert; mode "bulk" = whole document (LLM-only). */
    public record NlConvertRequest(String text, String filename, String carUid, String language, String mode) {}

    /** Body of POST /{filename}/rules/batch — accepted drafts, written in one go. */
    public record BatchRulesRequest(List<RuleEditDto> rules) {}

    /** How one signal reference in a converted rule resolved against the scope. */
    public record SignalResolutionDto(String reference, String status, List<String> candidates) {}

    /** One converted rule draft: the rule + resolution info, nothing saved yet. */
    public record RuleDraftDto(
            RuleEditDto rule,
            List<SignalResolutionDto> signals,
            double confidence,
            String source) {}

    /** Response of nl-convert; engine says which path answered (LLM or PARSER). */
    public record NlConvertResponse(List<RuleDraftDto> drafts, String engine, List<String> warnings) {}

    /**
     * Signals in scope for a requirement file: the union of catalog signals of
     * every car the file is assigned to. {@code scoped} is false when the file
     * is assigned to no car and all catalogs are returned instead.
     */
    public record SignalContextDto(String filename, boolean scoped, List<SignalOptionDto> signals) {}

    /** Listing row for one requirement-set file. */
    public record SummaryDto(
            String filename,
            String name,
            String version,
            long ruleCount,
            long draftCount,
            boolean active) {}

    /** Raw YAML source of one requirement-set file, for the source editor. */
    public record SourceDto(String filename, String yaml) {}

    /** A requirement set assigned to a car. */
    public record CarRequirementDto(String filename, String name, String version) {}

    /** Replace-assignment request body: the full set of filenames for a car. */
    public record AssignRequest(List<String> filenames) {}

    /**
     * Per-rule outcome in the session requirements report. Outcome is one of
     * PASS | VIOLATED | TIMING_VIOLATED | NOT_TESTED (draft rules are always
     * NOT_TESTED — tracked for coverage, never given a verdict).
     */
    public record RuleReportDto(
            String ruleId,
            String title,
            String severity,
            String kind,
            boolean draft,
            String sourceFile,
            String outcome,
            long passCount,
            long violatedCount,
            long timingViolatedCount) {}

    /**
     * Requirements report for one session (plan §2.3). {@code live} is true
     * while the session's engine state is still in memory; afterwards the
     * report is reconstructed from persisted findings (violations only —
     * pass counts are not recoverable once the session state is cleared).
     */
    public record RequirementReportDto(
            String sessionId,
            boolean live,
            int totalRules,
            long exercised,
            long passed,
            long violated,
            long timingViolated,
            long notTested,
            List<RuleReportDto> rules) {}
}
