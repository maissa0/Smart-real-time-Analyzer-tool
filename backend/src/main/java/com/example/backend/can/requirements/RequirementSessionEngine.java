package com.example.backend.can.requirements;

import com.example.backend.can.dto.SignalData;
import com.example.backend.can.requirements.RequirementModel.DerivedCase;
import com.example.backend.can.requirements.RequirementModel.DerivedSignal;
import com.example.backend.can.requirements.RequirementModel.Expectation;
import com.example.backend.can.requirements.RequirementModel.Predicate;
import com.example.backend.can.requirements.RequirementModel.RequirementFile;
import com.example.backend.can.requirements.RequirementModel.Rule;
import com.example.backend.can.requirements.RequirementModel.SignalEdge;
import com.example.backend.can.requirements.RequirementModel.Transition;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Pure per-session evaluation engine for one session's requirement-rule
 * snapshot (Phase 2, docs/ANOMALY_REDESIGN_PLAN.md §2.1). No Spring, no I/O —
 * frames go in, findings and coverage counters come out; persistence and
 * scheduling live in RequirementMonitorService.
 *
 * Fully generic: every signal name, state value, and rule id comes from the
 * user-uploaded requirement files; nothing here is car- or rule-specific.
 *
 * Threading: onFrame() runs on the session's single analysis-lane thread and
 * sweep() on the scheduler thread — both synchronize on this instance.
 *
 * Timing: deadlines are evaluated in the frame-timestamp domain (absolute Unix
 * seconds), so replayed logs behave identically to live streams. sweep() is
 * the arrival-clock fallback that fires deadlines when frames stop coming.
 */
public final class RequirementSessionEngine {

    public static final String TYPE_VIOLATED = "REQUIREMENT_VIOLATED";
    public static final String TYPE_TIMING = "REQUIREMENT_TIMING_VIOLATED";
    public static final String TYPE_ILLEGAL_TRANSITION = "ILLEGAL_TRANSITION";

    /** Wildcard accepted in edge from/to and expectation values: any value. */
    private static final String ANY = "*";

    /** Extra wall-clock slack before the sweeper fires a frame-time deadline. */
    private static final long SWEEP_GRACE_MS = 1000;

    /** One raised finding; the service maps it onto the findings store. */
    public record Finding(Rule rule, String sourceFile, String type, String description,
                          double ts, Map<String, Object> evidence) {}

    /** Immutable coverage counters for one rule. */
    public record CoverageView(long pass, long violated, long timingViolated) {
        public boolean exercised() {
            return pass + violated + timingViolated > 0;
        }
    }

    /** Latest known value of a signal: decoded label + raw value as text. */
    private record Value(String label, String raw) {}

    /** A same-frame transition of one signal (prev == null: first sighting). */
    private record Change(Value prev, Value now) {}

    /** Per-file evaluation context: signal_map indirection + derived values. */
    private static final class FileCtx {
        final RequirementFile file;
        final Map<String, DerivedSignal> derivedByName = new LinkedHashMap<>();
        final Map<String, Value> derivedValues = new HashMap<>();
        final Map<String, Change> frameChanges = new HashMap<>();

        FileCtx(RequirementFile file) {
            this.file = file;
            for (DerivedSignal d : file.derivedSignals()) {
                derivedByName.put(d.name(), d);
            }
        }
    }

    private record RuleRef(Rule rule, FileCtx ctx) {}

    /** Armed RESPONSE deadline, waiting for the expected edge. */
    private static final class Obligation {
        final RuleRef ref;
        final double triggerTs;
        final double deadlineTs;
        final long armedNanos;

        Obligation(RuleRef ref, double triggerTs, long armedNanos) {
            this.ref = ref;
            this.triggerTs = triggerTs;
            this.deadlineTs = triggerTs + ref.rule().effectiveDeadlineMs() / 1000.0;
            this.armedNanos = armedNanos;
        }
    }

    /** DURATION tracking: when the state was entered and whether it resolved. */
    private static final class DurationState {
        boolean active;
        boolean latched;   // outcome already recorded; wait for conditions to drop
        double enteredTs;
        long enteredNanos;
    }

    /** INVARIANT episode latches so one bad episode raises one finding. */
    private static final class InvariantState {
        boolean violationLatched;
        boolean passLatched;
    }

    private static final class Counters {
        long pass;
        long violated;
        long timingViolated;
    }

    private final Map<String, Value> busValues = new HashMap<>();
    private final Map<String, Change> busChanges = new HashMap<>();
    private final List<FileCtx> fileContexts = new ArrayList<>();
    private final List<RuleRef> rules = new ArrayList<>();
    private final List<Obligation> obligations = new ArrayList<>();
    private final Map<String, DurationState> durationStates = new HashMap<>();
    private final Map<String, InvariantState> invariantStates = new HashMap<>();
    private final Map<String, Double> absenceWindowEndTs = new HashMap<>();
    private final Map<String, Counters> coverage = new LinkedHashMap<>();

    public RequirementSessionEngine(Collection<RequirementFile> files) {
        for (RequirementFile file : files) {
            FileCtx ctx = new FileCtx(file);
            fileContexts.add(ctx);
            for (Rule rule : file.rules()) {
                rules.add(new RuleRef(rule, ctx));
                coverage.putIfAbsent(rule.id(), new Counters());
            }
        }
    }

    public int ruleCount() {
        return rules.size();
    }

    /** All (rule, source filename) pairs armed for this session, in file order. */
    public synchronized List<Map.Entry<Rule, String>> ruleList() {
        List<Map.Entry<Rule, String>> out = new ArrayList<>();
        for (RuleRef ref : rules) {
            out.add(Map.entry(ref.rule(), ref.ctx().file.filename()));
        }
        return out;
    }

    public synchronized CoverageView coverageFor(String ruleId) {
        Counters c = coverage.get(ruleId);
        return c == null ? new CoverageView(0, 0, 0)
                : new CoverageView(c.pass, c.violated, c.timingViolated);
    }

    /**
     * Evaluate one frame. {@code ts} is the absolute frame timestamp (Unix
     * seconds); {@code nowNanos} anchors the arrival clock for sweep().
     */
    public synchronized List<Finding> onFrame(double ts, long nowNanos, List<SignalData> signals) {
        List<Finding> out = new ArrayList<>();

        // ABSENCE while-conditions are judged on the state as it held BEFORE
        // this frame — the forbidden edge this frame carries must not be able
        // to satisfy (or break) its own guard.
        Map<String, Boolean> absenceHeldBefore = new HashMap<>();
        for (RuleRef ref : rules) {
            if (ref.rule().kind() == RequirementModel.RuleKind.ABSENCE
                    && !ref.rule().whileConds().isEmpty()) {
                absenceHeldBefore.put(ref.rule().id(), evalAll(ref.ctx(), ref.rule().whileConds()));
            }
        }

        applyBusSignals(signals);
        for (FileCtx ctx : fileContexts) {
            recomputeDerived(ctx);
        }

        for (RuleRef ref : rules) {
            switch (ref.rule().kind()) {
                case RESPONSE -> armResponseTrigger(ref, ts, nowNanos);
                case ABSENCE -> checkAbsence(ref, ts, absenceHeldBefore, out);
                case DURATION -> checkDuration(ref, ts, nowNanos, out);
                case INVARIANT -> checkInvariant(ref, ts, out);
            }
        }
        settleObligations(ts, out);
        return out;
    }

    /**
     * Arrival-clock fallback: fire frame-time deadlines whose wall-clock age
     * exceeds the deadline (plus grace) — catches "the stream just stopped".
     */
    public synchronized List<Finding> sweep(long nowNanos) {
        List<Finding> out = new ArrayList<>();
        for (Iterator<Obligation> it = obligations.iterator(); it.hasNext(); ) {
            Obligation o = it.next();
            double elapsedMs = (nowNanos - o.armedNanos) / 1_000_000.0;
            if (elapsedMs > o.ref.rule().effectiveDeadlineMs() + SWEEP_GRACE_MS) {
                it.remove();
                emitViolation(o.ref, TYPE_VIOLATED, o.deadlineTs, evidence(
                        "triggerTs", o.triggerTs,
                        "deadlineMs", o.ref.rule().effectiveDeadlineMs(),
                        "observed", "no response before the stream went silent",
                        "signals", involvedSignals(o.ref.ctx(),
                                o.ref.rule().trigger().signal(), o.ref.rule().expect().signal())), out);
            }
        }
        for (RuleRef ref : rules) {
            if (ref.rule().kind() != RequirementModel.RuleKind.DURATION) {
                continue;
            }
            DurationState st = durationStates.get(ref.rule().id());
            if (st == null || !st.active || st.latched) {
                continue;
            }
            double elapsedMs = (nowNanos - st.enteredNanos) / 1_000_000.0;
            if (elapsedMs > ref.rule().effectiveDeadlineMs() + SWEEP_GRACE_MS) {
                st.latched = true;
                emitViolation(ref, TYPE_VIOLATED,
                        st.enteredTs + ref.rule().effectiveDeadlineMs() / 1000.0, evidence(
                                "enteredTs", st.enteredTs,
                                "durationMs", ref.rule().effectiveDeadlineMs(),
                                "observed", "state still held when the stream went silent",
                                "signals", involvedSignals(ref.ctx(), ref.rule().expect().signal())), out);
            }
        }
        return out;
    }

    // ── Rule-kind handlers ────────────────────────────────────────────────────

    private void armResponseTrigger(RuleRef ref, double ts, long nowNanos) {
        Rule rule = ref.rule();
        Change c = changeFor(ref.ctx(), rule.trigger().signal());
        if (c == null || c.prev() == null || !edgeMatches(rule.trigger(), c)) {
            return;
        }
        if (!evalAll(ref.ctx(), rule.preconditions()) || hasPendingObligation(rule.id())) {
            return;
        }
        obligations.add(new Obligation(ref, ts, nowNanos));
    }

    private void settleObligations(double ts, List<Finding> out) {
        for (Iterator<Obligation> it = obligations.iterator(); it.hasNext(); ) {
            Obligation o = it.next();
            Rule rule = o.ref.rule();
            Change c = changeFor(o.ref.ctx(), rule.expect().signal());
            if (c != null && becomes(rule.expect(), c)) {
                it.remove();
                double latencyMs = (ts - o.triggerTs) * 1000.0;
                if (ts <= o.deadlineTs) {
                    countersFor(rule.id()).pass++;
                } else {
                    countersFor(rule.id()).timingViolated++;
                    if (!rule.draft()) {
                        out.add(finding(o.ref, TYPE_TIMING, ts, evidence(
                                "triggerTs", o.triggerTs,
                                "latencyMs", Math.round(latencyMs),
                                "deadlineMs", rule.effectiveDeadlineMs(),
                                "signals", involvedSignals(o.ref.ctx(),
                                        rule.trigger().signal(), rule.expect().signal()))));
                    }
                }
            } else if (ts > o.deadlineTs) {
                it.remove();
                emitViolation(o.ref, TYPE_VIOLATED, ts, evidence(
                        "triggerTs", o.triggerTs,
                        "deadlineMs", rule.effectiveDeadlineMs(),
                        "observed", "expected change not observed before the deadline",
                        "signals", involvedSignals(o.ref.ctx(),
                                rule.trigger().signal(), rule.expect().signal())), out);
            }
        }
    }

    private void checkAbsence(RuleRef ref, double ts, Map<String, Boolean> heldBefore,
                              List<Finding> out) {
        Rule rule = ref.rule();
        // Trigger+window form: a trigger edge opens a window in frame time.
        if (rule.trigger() != null && rule.windowMs() != null) {
            Change t = changeFor(ref.ctx(), rule.trigger().signal());
            if (t != null && t.prev() != null && edgeMatches(rule.trigger(), t)) {
                absenceWindowEndTs.put(rule.id(), ts + rule.windowMs() / 1000.0);
            }
        }
        Double windowEnd = absenceWindowEndTs.get(rule.id());
        if (windowEnd != null && ts > windowEnd) {
            absenceWindowEndTs.remove(rule.id());
            windowEnd = null;
        }

        boolean guarded = Boolean.TRUE.equals(heldBefore.get(rule.id())) || windowEnd != null;
        if (!guarded) {
            return;
        }
        Change c = changeFor(ref.ctx(), rule.forbidden().signal());
        if (c == null || c.prev() == null || !edgeMatches(rule.forbidden(), c)) {
            return;
        }
        emitViolation(ref, TYPE_VIOLATED, ts, evidence(
                "signal", rule.forbidden().signal(),
                "from", display(c.prev()),
                "to", display(c.now()),
                "guard", rule.whileConds().stream().map(Predicate::raw).toList(),
                "signals", involvedSignals(ref.ctx(), rule.forbidden().signal())), out);
    }

    private void checkDuration(RuleRef ref, double ts, long nowNanos, List<Finding> out) {
        Rule rule = ref.rule();
        DurationState st = durationStates.computeIfAbsent(rule.id(), k -> new DurationState());

        // The expected outcome usually ends the tracked state itself (e.g.
        // auto-lock leaves "unlocked"), so judge it before re-evaluating the
        // state conditions on this frame's values.
        Change c = changeFor(ref.ctx(), rule.expect().signal());
        if (st.active && !st.latched && c != null && becomes(rule.expect(), c)) {
            countersFor(rule.id()).pass++;
            st.active = false;
            st.latched = true;
        }

        if (!evalAll(ref.ctx(), rule.whileConds())) {
            st.active = false;
            st.latched = false;
            return;
        }
        if (st.latched) {
            return;
        }
        if (!st.active) {
            st.active = true;
            st.enteredTs = ts;
            st.enteredNanos = nowNanos;
            return;
        }
        if ((ts - st.enteredTs) * 1000.0 > rule.effectiveDeadlineMs()) {
            st.active = false;
            st.latched = true;
            emitViolation(ref, TYPE_VIOLATED, ts, evidence(
                    "enteredTs", st.enteredTs,
                    "durationMs", rule.effectiveDeadlineMs(),
                    "observed", "state held past the duration without the expected outcome",
                    "signals", involvedSignals(ref.ctx(), rule.expect().signal())), out);
        }
    }

    private void checkInvariant(RuleRef ref, double ts, List<Finding> out) {
        Rule rule = ref.rule();
        if (!rule.expectAll().isEmpty()) {
            checkPredicateInvariant(ref, ts, out);
        }
        if (rule.stateSignal() != null && !rule.allowedTransitions().isEmpty()) {
            checkTransitionInvariant(ref, ts, out);
        }
    }

    private void checkPredicateInvariant(RuleRef ref, double ts, List<Finding> out) {
        Rule rule = ref.rule();
        InvariantState st = invariantStates.computeIfAbsent(rule.id(), k -> new InvariantState());
        if (!evalAll(ref.ctx(), rule.whileConds())) {
            st.violationLatched = false;
            st.passLatched = false;
            return;
        }
        if (evalAll(ref.ctx(), rule.expectAll())) {
            st.violationLatched = false;
            if (!st.passLatched) {
                st.passLatched = true;
                countersFor(rule.id()).pass++;
            }
            return;
        }
        st.passLatched = false;
        if (!st.violationLatched) {
            st.violationLatched = true;
            emitViolation(ref, TYPE_VIOLATED, ts, evidence(
                    "when", rule.whileConds().stream().map(Predicate::raw).toList(),
                    "failed", failedPredicates(ref.ctx(), rule.expectAll()),
                    "signals", involvedSignals(ref.ctx(),
                            rule.expectAll().stream().map(Predicate::signal).toArray(String[]::new))), out);
        }
    }

    private void checkTransitionInvariant(RuleRef ref, double ts, List<Finding> out) {
        Rule rule = ref.rule();
        Change c = changeFor(ref.ctx(), rule.stateSignal());
        if (c == null || c.prev() == null) {
            return;
        }
        for (Transition t : rule.allowedTransitions()) {
            if (matches(c.prev(), t.from()) && matches(c.now(), t.to())) {
                countersFor(rule.id()).pass++;
                return;
            }
        }
        countersFor(rule.id()).violated++;
        if (!rule.draft()) {
            out.add(finding(ref, TYPE_ILLEGAL_TRANSITION, ts, evidence(
                    "signal", rule.stateSignal(),
                    "from", display(c.prev()),
                    "to", display(c.now()),
                    "signals", involvedSignals(ref.ctx(), rule.stateSignal()))));
        }
    }

    // ── Signal state, derived signals, edges ─────────────────────────────────

    private void applyBusSignals(List<SignalData> signals) {
        busChanges.clear();
        for (SignalData s : signals) {
            if (s.signalName() == null || s.rawValue() == null) {
                continue;
            }
            Value now = new Value(normalize(s.label()), String.valueOf(s.rawValue()));
            Value prev = busValues.get(s.signalName());
            if (!now.equals(prev)) {
                busValues.put(s.signalName(), now);
                busChanges.put(s.signalName(), new Change(prev, now));
            }
        }
    }

    /**
     * Recompute this file's derived signals from the current bus values —
     * cases top-down, first match wins. Values are sticky: when no case
     * matches, the last known state is kept (an unmapped intermediate value
     * must not fabricate transitions).
     */
    private void recomputeDerived(FileCtx ctx) {
        ctx.frameChanges.clear();
        for (DerivedSignal derived : ctx.derivedByName.values()) {
            String newValue = null;
            for (DerivedCase c : derived.cases()) {
                if (evalAllBus(ctx, c.conditions())) {
                    newValue = c.value();
                    break;
                }
            }
            if (newValue == null) {
                continue;
            }
            Value now = new Value(newValue, newValue);
            Value prev = ctx.derivedValues.get(derived.name());
            if (!now.equals(prev)) {
                ctx.derivedValues.put(derived.name(), now);
                ctx.frameChanges.put(derived.name(), new Change(prev, now));
            }
        }
    }

    /** Latest value of a rule-level signal name (derived first, then bus). */
    private Value resolve(FileCtx ctx, String name) {
        if (ctx.derivedByName.containsKey(name)) {
            return ctx.derivedValues.get(name);
        }
        return busValues.get(mapped(ctx, name));
    }

    /** This frame's change of a rule-level signal name, if any. */
    private Change changeFor(FileCtx ctx, String name) {
        if (ctx.derivedByName.containsKey(name)) {
            return ctx.frameChanges.get(name);
        }
        return busChanges.get(mapped(ctx, name));
    }

    private String mapped(FileCtx ctx, String name) {
        return ctx.file.signalMap().getOrDefault(name, name);
    }

    /**
     * Bus signal names behind rule-level names, for finding evidence — derived
     * signals expand to their {@code from} sources so the UI can correlate a
     * finding with real chartable signals (plan §3.2).
     */
    private List<String> involvedSignals(FileCtx ctx, String... names) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String name : names) {
            if (name == null) {
                continue;
            }
            DerivedSignal derived = ctx.derivedByName.get(name);
            if (derived != null) {
                for (String source : derived.from()) {
                    out.add(mapped(ctx, source));
                }
            } else {
                out.add(mapped(ctx, name));
            }
        }
        return List.copyOf(out);
    }

    // ── Predicate / edge evaluation ──────────────────────────────────────────

    private boolean evalAll(FileCtx ctx, List<Predicate> predicates) {
        for (Predicate p : predicates) {
            if (!eval(resolve(ctx, p.signal()), p)) {
                return false;
            }
        }
        return true;
    }

    /** Derived-case conditions read bus signals only (no derived recursion). */
    private boolean evalAllBus(FileCtx ctx, List<Predicate> predicates) {
        for (Predicate p : predicates) {
            if (!eval(busValues.get(mapped(ctx, p.signal())), p)) {
                return false;
            }
        }
        return true;
    }

    private List<String> failedPredicates(FileCtx ctx, List<Predicate> predicates) {
        List<String> failed = new ArrayList<>();
        for (Predicate p : predicates) {
            if (!eval(resolve(ctx, p.signal()), p)) {
                failed.add(p.raw());
            }
        }
        return failed;
    }

    /** An unknown signal value satisfies no predicate (conservative). */
    private static boolean eval(Value v, Predicate p) {
        if (v == null) {
            return false;
        }
        return switch (p.op()) {
            case EQ -> matches(v, p.values().get(0));
            case NE -> !matches(v, p.values().get(0));
            case IN -> p.values().stream().anyMatch(candidate -> matches(v, candidate));
            case LT, LE, GT, GE -> compareNumeric(v, p);
        };
    }

    private static boolean compareNumeric(Value v, Predicate p) {
        Double left = numeric(v);
        Double right = parseDouble(p.values().get(0));
        if (left == null || right == null) {
            return false;
        }
        return switch (p.op()) {
            case LT -> left < right;
            case LE -> left <= right;
            case GT -> left > right;
            case GE -> left >= right;
            default -> false;
        };
    }

    /** A literal matches a value on its label, its raw text, or numerically. */
    private static boolean matches(Value v, String literal) {
        if (v == null || literal == null) {
            return false;
        }
        if (literal.equals(v.label()) || literal.equals(v.raw())) {
            return true;
        }
        Double numericValue = numeric(v);
        Double numericLiteral = parseDouble(literal);
        return numericValue != null && numericValue.equals(numericLiteral);
    }

    private static boolean edgeMatches(SignalEdge edge, Change c) {
        boolean toOk = edge.to() == null || ANY.equals(edge.to()) || matches(c.now(), edge.to());
        boolean fromOk = edge.from() == null || ANY.equals(edge.from())
                || matches(c.prev(), edge.from());
        return toOk && fromOk;
    }

    /** Expectation match — first sighting of the value counts as "becomes". */
    private static boolean becomes(Expectation expect, Change c) {
        return ANY.equals(expect.becomes()) || matches(c.now(), expect.becomes());
    }

    // ── Findings / counters ───────────────────────────────────────────────────

    private boolean hasPendingObligation(String ruleId) {
        return obligations.stream().anyMatch(o -> o.ref.rule().id().equals(ruleId));
    }

    private Counters countersFor(String ruleId) {
        return coverage.computeIfAbsent(ruleId, k -> new Counters());
    }

    /** Count a violation; draft rules are tracked but never raise findings. */
    private void emitViolation(RuleRef ref, String type, double ts,
                               Map<String, Object> evidence, List<Finding> out) {
        countersFor(ref.rule().id()).violated++;
        if (!ref.rule().draft()) {
            out.add(finding(ref, type, ts, evidence));
        }
    }

    private Finding finding(RuleRef ref, String type, double ts, Map<String, Object> evidence) {
        Rule rule = ref.rule();
        String description = rule.violationTitle() != null ? rule.violationTitle()
                : rule.id() + ": " + rule.title();
        return new Finding(rule, ref.ctx().file.filename(), type, description, ts, evidence);
    }

    private static Map<String, Object> evidence(Object... keyValues) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            out.put(String.valueOf(keyValues[i]), keyValues[i + 1]);
        }
        return out;
    }

    private static String display(Value v) {
        if (v == null) {
            return null;
        }
        return v.label() != null ? v.label() : v.raw();
    }

    private static String normalize(String label) {
        return label == null || label.isBlank() ? null : label;
    }

    private static Double numeric(Value v) {
        Double raw = parseDouble(v.raw());
        return raw != null ? raw : parseDouble(v.label());
    }

    private static Double parseDouble(String s) {
        if (s == null || s.isEmpty()) {
            return null;
        }
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
