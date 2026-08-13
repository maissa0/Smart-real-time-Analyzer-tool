package com.example.backend.can.requirements;

import com.example.backend.can.requirements.RequirementModel.DerivedCase;
import com.example.backend.can.requirements.RequirementModel.DerivedSignal;
import com.example.backend.can.requirements.RequirementModel.Expectation;
import com.example.backend.can.requirements.RequirementModel.Op;
import com.example.backend.can.requirements.RequirementModel.Predicate;
import com.example.backend.can.requirements.RequirementModel.RequirementFile;
import com.example.backend.can.requirements.RequirementModel.Rule;
import com.example.backend.can.requirements.RequirementModel.RuleKind;
import com.example.backend.can.requirements.RequirementModel.Severity;
import com.example.backend.can.requirements.RequirementModel.SignalEdge;
import com.example.backend.can.requirements.RequirementModel.Transition;
import org.yaml.snakeyaml.Yaml;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * YAML -> {@link RequirementModel.RequirementFile} with strict validation and
 * human-readable error messages ("rule 'CA_1': deadline_ms must be > 0").
 *
 * Deliberately NOT a scripting engine: predicates are single comparisons
 * ({@code signal op literal}) parsed here and evaluated by the engine —
 * requirement files are user uploads and must never execute code.
 */
public final class RequirementParser {

    private static final Pattern PREDICATE = Pattern.compile(
            "^\\s*([A-Za-z_][\\w.]*)\\s*(==|!=|<=|>=|<|>|\\bin\\b)\\s*(.+?)\\s*$");
    private static final Pattern SIGNAL_NAME = Pattern.compile("^[A-Za-z_][\\w.]*$");

    private RequirementParser() {
    }

    /** @throws IllegalArgumentException with a user-facing message on any schema violation */
    @SuppressWarnings("unchecked")
    public static RequirementFile parse(String filename, String yamlText) {
        Object root;
        try {
            root = new Yaml().load(yamlText);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid YAML: " + firstLine(e.getMessage()));
        }
        if (!(root instanceof Map)) {
            throw new IllegalArgumentException("File must be a YAML mapping with 'meta' and 'rules'");
        }
        Map<String, Object> doc = (Map<String, Object>) root;

        Map<String, Object> meta = asMap(doc.get("meta"), "meta");
        String name = str(meta.get("name"), filename);
        String version = str(meta.get("version"), "1");

        Map<String, String> signalMap = new LinkedHashMap<>();
        Object rawMap = meta.get("signal_map");
        if (rawMap instanceof Map<?, ?> m) {
            m.forEach((k, v) -> signalMap.put(String.valueOf(k), String.valueOf(v)));
        }

        List<DerivedSignal> derived = parseDerivedSignals(meta.get("derived_signals"));

        // An empty rules list is valid: freshly created files start empty and
        // rules are added one by one through the structured endpoints.
        Object rulesObj = doc.get("rules");
        List<?> rawRules = rulesObj == null ? List.of()
                : asList(rulesObj, "'rules' must be a list");

        Set<String> seenIds = new HashSet<>();
        List<Rule> rules = new ArrayList<>();
        for (Object r : rawRules) {
            Rule rule = parseRule(asMap(r, "rules entry"));
            if (!seenIds.add(rule.id())) {
                throw new IllegalArgumentException("Duplicate rule id: " + rule.id());
            }
            rules.add(rule);
        }
        return new RequirementFile(filename, name, version, signalMap, derived, rules);
    }

    /** Parse one predicate string like {@code KEY_Pos == 'Outside'} or {@code x in [1, 2]}. */
    public static Predicate parsePredicate(String raw) {
        Matcher m = PREDICATE.matcher(raw);
        if (!m.matches()) {
            throw new IllegalArgumentException(
                    "Bad predicate '" + raw + "' — expected: signal (== != < <= > >= in) value");
        }
        String signal = m.group(1);
        Op op = switch (m.group(2)) {
            case "==" -> Op.EQ;
            case "!=" -> Op.NE;
            case "<" -> Op.LT;
            case "<=" -> Op.LE;
            case ">" -> Op.GT;
            case ">=" -> Op.GE;
            default -> Op.IN;
        };
        String rhs = m.group(3).trim();
        List<String> values = new ArrayList<>();
        if (op == Op.IN) {
            if (!rhs.startsWith("[") || !rhs.endsWith("]")) {
                throw new IllegalArgumentException(
                        "Bad predicate '" + raw + "' — 'in' needs a [a, b, ...] list");
            }
            for (String part : rhs.substring(1, rhs.length() - 1).split(",")) {
                String v = unquote(part.trim());
                if (!v.isEmpty()) {
                    values.add(v);
                }
            }
            if (values.isEmpty()) {
                throw new IllegalArgumentException("Bad predicate '" + raw + "' — empty 'in' list");
            }
        } else {
            values.add(unquote(rhs));
        }
        return new Predicate(signal, op, List.copyOf(values), raw);
    }

    // ── Rule parsing ──────────────────────────────────────────────────────────

    private static Rule parseRule(Map<String, Object> r) {
        String id = str(r.get("id"), null);
        require(id != null && !id.isBlank(), "Every rule needs an 'id'");
        String where = "rule '" + id + "': ";

        RuleKind kind;
        try {
            kind = RuleKind.valueOf(str(r.get("kind"), "").toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(
                    where + "kind must be one of response|absence|duration|invariant");
        }
        Severity severity = parseSeverity(r.get("severity"), where);
        boolean draft = Boolean.TRUE.equals(r.get("draft"));

        List<Predicate> preconditions = predicates(r.get("preconditions"), where + "preconditions: ");
        // Level conditions: accept any of the aliases the plan documents per kind.
        List<Predicate> whileConds = new ArrayList<>();
        whileConds.addAll(predicates(r.get("while"), where + "while: "));
        whileConds.addAll(predicates(r.get("state"), where + "state: "));
        whileConds.addAll(predicates(r.get("when"), where + "when: "));

        SignalEdge trigger = edge(r.get("trigger"), where + "trigger: ");
        SignalEdge forbidden = edge(r.get("forbidden"), where + "forbidden: ");
        Expectation expect = expectation(r.get("expect"), where + "expect: ");
        List<Predicate> expectAll = predicates(r.get("expect_all"), where + "expect_all: ");

        Long deadlineMs = positiveMs(r.get("deadline_ms"), where + "deadline_ms");
        Long durationMs = positiveMs(r.get("duration_ms"), where + "duration_ms");
        Long windowMs = positiveMs(r.get("window_ms"), where + "window_ms");
        Double tolerancePct = tolerance(r.get("tolerance_pct"), where);

        String stateSignal = str(r.get("state_signal"), null);
        List<Transition> transitions = transitions(r.get("allowed_transitions"), where);

        switch (kind) {
            case RESPONSE -> {
                require(trigger != null, where + "response rules need a 'trigger'");
                require(expect != null, where + "response rules need an 'expect'");
                require(deadlineMs != null, where + "response rules need 'deadline_ms'");
            }
            case ABSENCE -> {
                require(forbidden != null, where + "absence rules need a 'forbidden' edge");
                require(!whileConds.isEmpty() || (trigger != null && windowMs != null),
                        where + "absence rules need 'while' conditions or trigger+window_ms");
            }
            case DURATION -> {
                require(!whileConds.isEmpty(), where + "duration rules need 'state' conditions");
                require(durationMs != null, where + "duration rules need 'duration_ms'");
                require(expect != null, where + "duration rules need an 'expect'");
            }
            case INVARIANT -> {
                boolean predicateForm = !expectAll.isEmpty();
                boolean transitionForm = stateSignal != null && !transitions.isEmpty();
                require(predicateForm || transitionForm,
                        where + "invariant rules need 'expect_all' or state_signal+allowed_transitions");
                require(stateSignal == null || SIGNAL_NAME.matcher(stateSignal).matches(),
                        where + "state_signal is not a valid signal name");
            }
        }

        List<String> checkList = strings(r.get("check_list"));
        return new Rule(id.trim(),
                str(r.get("title"), id),
                str(r.get("component"), null),
                severity, kind, draft,
                List.copyOf(preconditions), List.copyOf(whileConds),
                trigger, forbidden, expect, List.copyOf(expectAll),
                deadlineMs, durationMs, windowMs, tolerancePct,
                stateSignal, List.copyOf(transitions),
                str(r.get("violation_title"), null),
                List.copyOf(checkList));
    }

    // ── Fragment parsers ──────────────────────────────────────────────────────

    private static List<DerivedSignal> parseDerivedSignals(Object obj) {
        if (obj == null) {
            return List.of();
        }
        List<DerivedSignal> out = new ArrayList<>();
        for (Object entry : asList(obj, "meta.derived_signals must be a list")) {
            Map<String, Object> d = asMap(entry, "derived_signals entry");
            String name = str(d.get("name"), null);
            require(name != null && SIGNAL_NAME.matcher(name).matches(),
                    "derived_signals: every entry needs a valid 'name'");
            List<String> from = strings(d.get("from"));
            List<DerivedCase> cases = new ArrayList<>();
            for (Object c : asList(d.get("cases"), "derived signal '" + name + "' needs 'cases'")) {
                Map<String, Object> cm = asMap(c, "derived case");
                String value = str(cm.get("value"), null);
                require(value != null, "derived signal '" + name + "': case needs a 'value'");
                cases.add(new DerivedCase(value,
                        predicates(cm.get("when"), "derived signal '" + name + "': ")));
            }
            require(!cases.isEmpty(), "derived signal '" + name + "' needs at least one case");
            out.add(new DerivedSignal(name, List.copyOf(from), List.copyOf(cases)));
        }
        return List.copyOf(out);
    }

    private static List<Predicate> predicates(Object obj, String where) {
        if (obj == null) {
            return List.of();
        }
        List<Predicate> out = new ArrayList<>();
        for (Object o : asList(obj, where + "must be a list")) {
            try {
                out.add(parsePredicate(String.valueOf(o)));
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException(where + e.getMessage());
            }
        }
        return out;
    }

    private static SignalEdge edge(Object obj, String where) {
        if (obj == null) {
            return null;
        }
        Map<String, Object> m = asMap(obj, where + "must be a mapping");
        String signal = str(m.get("signal"), null);
        require(signal != null && SIGNAL_NAME.matcher(signal).matches(),
                where + "needs a valid 'signal'");
        String to = str(m.get("to"), null);
        String from = str(m.get("from"), null);
        require(to != null || from != null, where + "needs 'to' and/or 'from'");
        return new SignalEdge(signal, from, to);
    }

    private static Expectation expectation(Object obj, String where) {
        if (obj == null) {
            return null;
        }
        Map<String, Object> m = asMap(obj, where + "must be a mapping");
        String signal = str(m.get("signal"), null);
        String becomes = str(m.get("becomes"), null);
        require(signal != null && SIGNAL_NAME.matcher(signal).matches(),
                where + "needs a valid 'signal'");
        require(becomes != null, where + "needs 'becomes'");
        return new Expectation(signal, becomes);
    }

    private static List<Transition> transitions(Object obj, String where) {
        if (obj == null) {
            return List.of();
        }
        List<Transition> out = new ArrayList<>();
        for (Object o : asList(obj, where + "allowed_transitions must be a list")) {
            List<?> pair = (o instanceof List<?> l) ? l : null;
            require(pair != null && pair.size() == 2,
                    where + "allowed_transitions entries must be [from, to] pairs");
            out.add(new Transition(String.valueOf(pair.get(0)), String.valueOf(pair.get(1))));
        }
        return out;
    }

    private static Severity parseSeverity(Object obj, String where) {
        if (obj == null) {
            return Severity.MEDIUM;
        }
        try {
            return Severity.valueOf(String.valueOf(obj).toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(
                    where + "severity must be critical|high|medium|low|info");
        }
    }

    private static Long positiveMs(Object obj, String where) {
        if (obj == null) {
            return null;
        }
        try {
            long v = Long.parseLong(String.valueOf(obj).trim());
            require(v > 0, where + " must be > 0");
            return v;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(where + " must be an integer (milliseconds)");
        }
    }

    private static Double tolerance(Object obj, String where) {
        if (obj == null) {
            return null;
        }
        try {
            double v = Double.parseDouble(String.valueOf(obj).trim());
            require(v >= 0 && v <= 100, where + "tolerance_pct must be 0-100");
            return v;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(where + "tolerance_pct must be a number");
        }
    }

    // ── Small helpers ─────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object obj, String what) {
        if (!(obj instanceof Map)) {
            throw new IllegalArgumentException("'" + what + "' must be a YAML mapping");
        }
        return (Map<String, Object>) obj;
    }

    private static List<?> asList(Object obj, String message) {
        if (!(obj instanceof List<?> l)) {
            throw new IllegalArgumentException(message);
        }
        return l;
    }

    private static List<String> strings(Object obj) {
        if (obj == null) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (Object o : asList(obj, "expected a list of strings")) {
            out.add(String.valueOf(o));
        }
        return out;
    }

    private static String str(Object obj, String fallback) {
        return obj == null ? fallback : String.valueOf(obj);
    }

    private static String unquote(String s) {
        if (s.length() >= 2
                && ((s.startsWith("'") && s.endsWith("'"))
                || (s.startsWith("\"") && s.endsWith("\"")))) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalArgumentException(message);
        }
    }

    private static String firstLine(String s) {
        if (s == null) {
            return "unparseable";
        }
        int nl = s.indexOf('\n');
        return nl > 0 ? s.substring(0, nl) : s;
    }
}
