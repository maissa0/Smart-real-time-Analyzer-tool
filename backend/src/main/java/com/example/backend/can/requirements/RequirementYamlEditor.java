package com.example.backend.can.requirements;

import com.example.backend.can.dto.RequirementDtos.DerivedSignalEditDto;
import com.example.backend.can.dto.RequirementDtos.EdgeDto;
import com.example.backend.can.dto.RequirementDtos.MetaUpdateDto;
import com.example.backend.can.dto.RequirementDtos.RuleEditDto;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Structured YAML mutations for requirement-set files (Phase A of
 * docs/REQUIREMENTS_AUTHORING_PLAN.md). The file is loaded as generic YAML
 * maps, mutated in place, and re-dumped — so keys this code does not know
 * about survive a round-trip. Comments and hand formatting are lost, which
 * the plan accepts (the Source tab remains the raw round-trip).
 *
 * Every method is text -> text; callers MUST validate the result with
 * {@link RequirementParser#parse} before writing it to disk.
 */
public final class RequirementYamlEditor {

    private RequirementYamlEditor() {
    }

    /** Minimal valid content for a newly created requirement file. */
    public static String newFile(String name) {
        Map<String, Object> doc = new LinkedHashMap<>();
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("name", name);
        meta.put("version", "1");
        doc.put("meta", meta);
        doc.put("rules", new ArrayList<>());
        return dump(doc);
    }

    /** Append one rule to the file's rules list. */
    public static String addRule(String yaml, RuleEditDto rule) {
        Map<String, Object> doc = load(yaml);
        rules(doc).add(ruleToMap(rule));
        return dump(doc);
    }

    /** Replace the rule whose id is {@code ruleId} (the new rule may rename it). */
    public static String updateRule(String yaml, String ruleId, RuleEditDto rule) {
        Map<String, Object> doc = load(yaml);
        List<Object> rules = rules(doc);
        int index = indexOfRule(rules, ruleId);
        rules.set(index, ruleToMap(rule));
        return dump(doc);
    }

    /** Remove the rule whose id is {@code ruleId}. */
    public static String deleteRule(String yaml, String ruleId) {
        Map<String, Object> doc = load(yaml);
        List<Object> rules = rules(doc);
        rules.remove(indexOfRule(rules, ruleId));
        return dump(doc);
    }

    /** Replace the meta section's name/version/signal_map/derived_signals. */
    public static String updateMeta(String yaml, MetaUpdateDto meta) {
        Map<String, Object> doc = load(yaml);
        Object rawMeta = doc.get("meta");
        Map<String, Object> metaMap = rawMeta instanceof Map<?, ?> m
                ? castMap(m) : new LinkedHashMap<>();
        doc.put("meta", metaMap);

        if (notBlank(meta.name())) {
            metaMap.put("name", meta.name().trim());
        }
        if (notBlank(meta.version())) {
            metaMap.put("version", meta.version().trim());
        }
        putOrRemove(metaMap, "signal_map",
                meta.signalMap() == null || meta.signalMap().isEmpty()
                        ? null : new LinkedHashMap<>(meta.signalMap()));
        putOrRemove(metaMap, "derived_signals", derivedToList(meta.derivedSignals()));
        return dump(doc);
    }

    // ── DTO -> YAML mapping ───────────────────────────────────────────────────

    private static Map<String, Object> ruleToMap(RuleEditDto r) {
        if (r == null || !notBlank(r.id())) {
            throw new IllegalArgumentException("Every rule needs an 'id'");
        }
        String kind = r.kind() == null ? "" : r.kind().trim().toLowerCase(Locale.ROOT);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.id().trim());
        putIfNotBlank(m, "title", r.title());
        m.put("kind", kind);
        putIfNotBlank(m, "severity",
                r.severity() == null ? null : r.severity().toLowerCase(Locale.ROOT));
        if (r.draft()) {
            m.put("draft", true);
        }
        putIfNotBlank(m, "component", r.component());
        putStrings(m, "preconditions", r.preconditions());
        // The parser accepts while/state/when aliases; write the alias that
        // matches the kind so the YAML reads like the documented examples.
        String whileKey = switch (kind) {
            case "duration" -> "state";
            case "invariant" -> "when";
            default -> "while";
        };
        putStrings(m, whileKey, r.whileConds());
        putEdge(m, "trigger", r.trigger());
        putEdge(m, "forbidden", r.forbidden());
        if (r.expect() != null && notBlank(r.expect().signal())) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("signal", r.expect().signal().trim());
            e.put("becomes", r.expect().becomes() == null ? "" : r.expect().becomes().trim());
            m.put("expect", e);
        }
        putStrings(m, "expect_all", r.expectAll());
        putIfNotNull(m, "deadline_ms", r.deadlineMs());
        putIfNotNull(m, "duration_ms", r.durationMs());
        putIfNotNull(m, "window_ms", r.windowMs());
        putIfNotNull(m, "tolerance_pct", r.tolerancePct());
        putIfNotBlank(m, "state_signal", r.stateSignal());
        if (r.allowedTransitions() != null && !r.allowedTransitions().isEmpty()) {
            List<List<String>> transitions = new ArrayList<>();
            for (List<String> pair : r.allowedTransitions()) {
                if (pair != null && pair.size() == 2) {
                    transitions.add(List.of(String.valueOf(pair.get(0)), String.valueOf(pair.get(1))));
                }
            }
            if (!transitions.isEmpty()) {
                m.put("allowed_transitions", transitions);
            }
        }
        putIfNotBlank(m, "violation_title", r.violationTitle());
        putStrings(m, "check_list", r.checkList());
        return m;
    }

    private static List<Map<String, Object>> derivedToList(List<DerivedSignalEditDto> derived) {
        if (derived == null || derived.isEmpty()) {
            return null;
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (DerivedSignalEditDto d : derived) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", d.name() == null ? "" : d.name().trim());
            putStrings(m, "from", d.from());
            List<Map<String, Object>> cases = new ArrayList<>();
            if (d.cases() != null) {
                for (var c : d.cases()) {
                    Map<String, Object> cm = new LinkedHashMap<>();
                    cm.put("value", c.value() == null ? "" : c.value());
                    putStrings(cm, "when", c.when());
                    cases.add(cm);
                }
            }
            m.put("cases", cases);
            out.add(m);
        }
        return out;
    }

    // ── YAML plumbing ─────────────────────────────────────────────────────────

    private static Map<String, Object> load(String yaml) {
        Object root;
        try {
            root = new Yaml().load(yaml);
        } catch (Exception e) {
            throw new IllegalArgumentException("File on disk is not valid YAML — fix it in the Source tab");
        }
        if (!(root instanceof Map<?, ?> m)) {
            throw new IllegalArgumentException("File on disk is not a YAML mapping — fix it in the Source tab");
        }
        return castMap(m);
    }

    private static String dump(Map<String, Object> doc) {
        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setIndent(2);
        options.setPrettyFlow(true);
        return new Yaml(options).dump(doc);
    }

    private static List<Object> rules(Map<String, Object> doc) {
        Object raw = doc.get("rules");
        if (raw instanceof List<?> l) {
            List<Object> rules = new ArrayList<>(l);
            doc.put("rules", rules);
            return rules;
        }
        List<Object> rules = new ArrayList<>();
        doc.put("rules", rules);
        return rules;
    }

    private static int indexOfRule(List<Object> rules, String ruleId) {
        for (int i = 0; i < rules.size(); i++) {
            if (rules.get(i) instanceof Map<?, ?> m
                    && ruleId.equals(String.valueOf(m.get("id")))) {
                return i;
            }
        }
        throw new IllegalArgumentException("Rule not found: " + ruleId);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> m) {
        return new LinkedHashMap<>((Map<String, Object>) m);
    }

    private static void putStrings(Map<String, Object> m, String key, List<String> values) {
        if (values == null) {
            return;
        }
        List<String> cleaned = values.stream()
                .filter(RequirementYamlEditor::notBlank)
                .map(String::trim)
                .toList();
        if (!cleaned.isEmpty()) {
            m.put(key, new ArrayList<>(cleaned));
        }
    }

    private static void putEdge(Map<String, Object> m, String key, EdgeDto edge) {
        if (edge == null || !notBlank(edge.signal())) {
            return;
        }
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("signal", edge.signal().trim());
        putIfNotBlank(e, "from", edge.from());
        putIfNotBlank(e, "to", edge.to());
        m.put(key, e);
    }

    private static void putIfNotBlank(Map<String, Object> m, String key, String value) {
        if (notBlank(value)) {
            m.put(key, value.trim());
        }
    }

    private static void putIfNotNull(Map<String, Object> m, String key, Object value) {
        if (value != null) {
            m.put(key, value);
        }
    }

    private static void putOrRemove(Map<String, Object> m, String key, Object value) {
        if (value == null) {
            m.remove(key);
        } else {
            m.put(key, value);
        }
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
