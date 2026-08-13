package com.example.backend.can.requirements;

import java.util.List;
import java.util.Map;

/**
 * Parsed, validated in-memory form of one user-uploaded requirement-set YAML
 * file. Fully generic: nothing about signal names, states, or rule ids is
 * hardcoded anywhere — files are dynamic and assigned per car, exactly like
 * ECU catalogs (see docs/ANOMALY_REDESIGN_PLAN.md, Phase 1).
 */
public final class RequirementModel {

    private RequirementModel() {
    }

    /** How a rule is evaluated by the Phase-2 engine. */
    public enum RuleKind { RESPONSE, ABSENCE, DURATION, INVARIANT }

    public enum Severity { CRITICAL, HIGH, MEDIUM, LOW, INFO }

    public enum Op { EQ, NE, LT, LE, GT, GE, IN }

    /**
     * One comparison from the tiny predicate language: {@code signal op literal}
     * with ops {@code == != < <= > >= in}. Values are kept as strings; the
     * engine compares numerically when both sides parse as numbers.
     */
    public record Predicate(String signal, Op op, List<String> values, String raw) {}

    /** A signal transition; {@code from} may be null (any previous value). */
    public record SignalEdge(String signal, String from, String to) {}

    /** Expected outcome: {@code signal} must become {@code becomes}. */
    public record Expectation(String signal, String becomes) {}

    /** One allowed transition of an invariant's state signal. */
    public record Transition(String from, String to) {}

    /**
     * A signal not present on the bus, computed from others. Cases are
     * evaluated top-down, first match wins.
     */
    public record DerivedSignal(String name, List<String> from, List<DerivedCase> cases) {}

    /** {@code value} when all {@code conditions} hold. */
    public record DerivedCase(String value, List<Predicate> conditions) {}

    /**
     * One requirement rule. Field usage by kind:
     * RESPONSE  — preconditions (at trigger), trigger, expect, deadlineMs, tolerancePct
     * ABSENCE   — whileConds (level) and/or trigger+windowMs, forbidden
     * DURATION  — whileConds (state), durationMs, tolerancePct, expect
     * INVARIANT — whileConds (when) + expectAll, or stateSignal + allowedTransitions
     */
    public record Rule(
            String id,
            String title,
            String component,
            Severity severity,
            RuleKind kind,
            boolean draft,
            List<Predicate> preconditions,
            List<Predicate> whileConds,
            SignalEdge trigger,
            SignalEdge forbidden,
            Expectation expect,
            List<Predicate> expectAll,
            Long deadlineMs,
            Long durationMs,
            Long windowMs,
            Double tolerancePct,
            String stateSignal,
            List<Transition> allowedTransitions,
            String violationTitle,
            List<String> checkList) {

        /** Deadline including tolerance, in milliseconds (RESPONSE/DURATION). */
        public long effectiveDeadlineMs() {
            long base = deadlineMs != null ? deadlineMs : (durationMs != null ? durationMs : 0);
            double tol = tolerancePct != null ? tolerancePct : 0.0;
            return Math.round(base * (1.0 + tol / 100.0));
        }
    }

    /** A whole parsed requirement-set file. */
    public record RequirementFile(
            String filename,
            String name,
            String version,
            Map<String, String> signalMap,
            List<DerivedSignal> derivedSignals,
            List<Rule> rules) {

        public long ruleCount() {
            return rules.size();
        }

        public long draftCount() {
            return rules.stream().filter(Rule::draft).count();
        }
    }
}
