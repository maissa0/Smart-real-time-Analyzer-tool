package com.example.backend.can.service;

import com.example.backend.can.dto.RequirementDtos.EdgeDto;
import com.example.backend.can.dto.RequirementDtos.ExpectDto;
import com.example.backend.can.dto.RequirementDtos.NlConvertRequest;
import com.example.backend.can.dto.RequirementDtos.NlConvertResponse;
import com.example.backend.can.dto.RequirementDtos.RuleDraftDto;
import com.example.backend.can.dto.RequirementDtos.RuleEditDto;
import com.example.backend.can.dto.RequirementDtos.SignalContextDto;
import com.example.backend.can.dto.RequirementDtos.SignalOptionDto;
import com.example.backend.can.dto.RequirementDtos.SignalResolutionDto;
import com.example.backend.can.requirements.RequirementParser;
import com.example.backend.can.requirements.RequirementSentenceParser;
import com.example.backend.can.requirements.RequirementYamlEditor;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.UnaryOperator;

/**
 * Natural language -> structured rule conversion (Phase C of
 * docs/REQUIREMENTS_AUTHORING_PLAN.md). LLM path (Groq) when configured and
 * reachable, deterministic EN/FR pattern parser otherwise; the response says
 * which engine answered. Nothing is written — the caller previews the draft in
 * the structured form and saves through the Phase A endpoints.
 *
 * Only the sentence and in-scope signal names/labels are sent to the LLM;
 * LLM output is untrusted and re-validated against the requirement model.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RequirementNlService {

    private final GroqClient groqClient;
    private final RequirementService requirementService;
    private final ObjectMapper objectMapper;

    @Value("${groq.api-key:}")
    private String groqApiKey;

    private record ResolvedRule(RuleEditDto rule, List<SignalResolutionDto> resolutions) {}

    public NlConvertResponse convert(NlConvertRequest request) {
        if (request == null || request.text() == null || request.text().isBlank()) {
            throw new IllegalArgumentException("Provide a requirement sentence in 'text'");
        }
        String sentence = request.text().trim();
        SignalContextDto scope = requirementService.signalContext(
                request.filename() == null ? "" : request.filename(), request.carUid());

        if ("bulk".equalsIgnoreCase(request.mode())) {
            return convertBulk(sentence, scope);
        }

        List<String> warnings = new ArrayList<>();
        RuleEditDto rule = null;
        String engine = "PARSER";

        if (groqApiKey != null && !groqApiKey.isBlank()) {
            try {
                rule = llmConvert(sentence, scope);
                engine = "LLM";
            } catch (Exception e) {
                log.warn("NL convert LLM path failed: {}", e.getMessage());
                warnings.add("LLM conversion failed — used the local pattern parser instead.");
            }
        } else {
            warnings.add("LLM not configured — used the local pattern parser.");
        }

        if (rule == null) {
            rule = RequirementSentenceParser.parse(sentence).orElse(null);
            if (rule == null) {
                warnings.add("Sentence not recognized. Supported shapes: "
                        + "\"when X becomes V, Y must become W within N ms\", "
                        + "\"X must never become V while Y is W\", "
                        + "\"X must stay V for N ms\", \"X is always V\" (EN + FR).");
                return new NlConvertResponse(List.of(), engine, warnings);
            }
        }

        RuleDraftDto draft = buildDraft(rule, scope, engine, warnings, sentence);
        return new NlConvertResponse(List.of(draft), engine, warnings);
    }

    /**
     * Shared post-processing for one converted rule: resolve signals against
     * the scope (canonicalizing spellings), force draft when anything is
     * unresolved, validate (warning only), and score confidence.
     */
    private RuleDraftDto buildDraft(RuleEditDto rule, SignalContextDto scope,
                                    String engine, List<String> warnings, String source) {
        ResolvedRule resolved = resolveSignals(rule, scope);
        rule = resolved.rule();
        long fuzzy = resolved.resolutions().stream()
                .filter(r -> "fuzzy".equals(r.status())).count();
        long unresolved = resolved.resolutions().stream()
                .filter(r -> "unresolved".equals(r.status())).count();
        if (unresolved > 0) {
            rule = withDraft(rule);
            warnings.add("Rule '" + rule.id() + "': signals not in the assigned cars' "
                    + "catalogs — marked as draft.");
        }
        try {
            validate(rule);
        } catch (IllegalArgumentException e) {
            warnings.add("Rule '" + rule.id() + "' needs manual fixes before it can be saved: "
                    + e.getMessage());
        }
        double confidence = clamp(("LLM".equals(engine) ? 0.9 : 0.8)
                - 0.05 * fuzzy - 0.15 * unresolved);
        return new RuleDraftDto(rule, resolved.resolutions(), confidence, source);
    }

    /**
     * Bulk mode (Phase D): the LLM splits a pasted document into individual
     * requirements — one draft per requirement. LLM-only by design; without a
     * configured/reachable LLM the response is empty with a warning so the UI
     * can tell the user bulk is unavailable.
     */
    private NlConvertResponse convertBulk(String document, SignalContextDto scope) {
        List<String> warnings = new ArrayList<>();
        if (groqApiKey == null || groqApiKey.isBlank()) {
            warnings.add("Bulk conversion requires the configured LLM — it is not available. "
                    + "Convert sentences one by one instead.");
            return new NlConvertResponse(List.of(), "LLM", warnings);
        }
        JsonNode root;
        try {
            String content = groqClient.complete(bulkSystemPrompt(scope), document);
            root = objectMapper.readTree(content);
        } catch (Exception e) {
            log.warn("Bulk NL convert failed: {}", e.getMessage());
            warnings.add("Bulk conversion failed — the LLM was unreachable or returned "
                    + "unusable output. Try again or convert sentences one by one.");
            return new NlConvertResponse(List.of(), "LLM", warnings);
        }
        JsonNode rules = root.has("rules") && root.get("rules").isArray()
                ? root.get("rules")
                : objectMapper.createArrayNode().add(root);
        List<RuleDraftDto> drafts = new ArrayList<>();
        int index = 0;
        for (JsonNode node : rules) {
            index++;
            String source = node.has("source") ? node.get("source").asText() : "requirement " + index;
            try {
                RuleEditDto rule = mapNode(node, "NL_" + index);
                drafts.add(buildDraft(rule, scope, "LLM", warnings, source));
            } catch (IllegalArgumentException e) {
                warnings.add("Skipped requirement " + index + " — " + e.getMessage());
            }
        }
        if (drafts.isEmpty()) {
            warnings.add("No usable rules found in the document.");
        }
        return new NlConvertResponse(drafts, "LLM", warnings);
    }

    // ── LLM path ──────────────────────────────────────────────────────────────

    /** One Groq call; on invalid output one retry with the validation error. */
    private RuleEditDto llmConvert(String sentence, SignalContextDto scope) {
        String system = systemPrompt(scope);
        String content = groqClient.complete(system, sentence);
        try {
            return mapAndValidate(content);
        } catch (IllegalArgumentException firstError) {
            log.info("LLM rule invalid, retrying once: {}", firstError.getMessage());
            String retry = groqClient.complete(system,
                    sentence + "\n\nYour previous answer was invalid: " + firstError.getMessage()
                            + "\nReturn a corrected JSON rule.");
            return mapAndValidate(retry);
        }
    }

    /** Parse the LLM JSON, map onto RuleEditDto, validate via the rule parser. */
    private RuleEditDto mapAndValidate(String content) {
        JsonNode node;
        try {
            node = objectMapper.readTree(content);
        } catch (Exception e) {
            throw new IllegalArgumentException("not valid JSON");
        }
        if (node.has("rule")) {
            node = node.get("rule");
        } else if (node.has("rules") && node.get("rules").isArray() && node.get("rules").size() > 0) {
            node = node.get("rules").get(0);
        }
        return mapNode(node, "NL_RULE");
    }

    /** One JSON node -> validated RuleEditDto (throws with a usable message). */
    private RuleEditDto mapNode(JsonNode node, String fallbackId) {
        if (node instanceof com.fasterxml.jackson.databind.node.ObjectNode obj) {
            obj.remove("source"); // bulk rules may carry the source sentence
        }
        RuleEditDto rule;
        try {
            rule = objectMapper.convertValue(node, RuleEditDto.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("JSON does not match the rule schema");
        }
        if (rule == null || rule.id() == null || rule.id().isBlank()) {
            rule = withId(rule, fallbackId);
        }
        validate(rule);
        return rule;
    }

    /** Bulk variant of the prompt: split the document, one rule per requirement. */
    private String bulkSystemPrompt(SignalContextDto scope) {
        return systemPrompt(scope) + """

                BULK MODE: the user pastes a DOCUMENT containing SEVERAL requirements.
                Split it into individual requirements and respond with
                {"rules": [rule, rule, ...]} — one JSON rule per requirement, each with a
                UNIQUE "id" and an extra "source" field holding the original sentence.
                Skip headings and text that is not a testable requirement.
                """;
    }

    private String systemPrompt(SignalContextDto scope) {
        StringBuilder signals = new StringBuilder();
        // Distinct names with labels, capped so huge fleets don't blow the prompt.
        Map<String, Set<String>> byName = new TreeMap<>();
        for (SignalOptionDto s : scope.signals()) {
            byName.computeIfAbsent(s.name(), k -> new LinkedHashSet<>()).addAll(s.labels());
            if (byName.size() >= 200) {
                break;
            }
        }
        byName.forEach((name, labels) -> signals.append("- ").append(name)
                .append(labels.isEmpty() ? "" : " (values: " + String.join(", ", labels) + ")")
                .append('\n'));
        return """
                You convert one automotive CAN requirement sentence (English or French) into ONE JSON rule.
                Respond with ONLY a JSON object of this exact shape (null / [] for unused fields):
                {"id": "RULE_ID", "title": "...", "component": null, "severity": "critical|high|medium|low|info",
                 "kind": "response|absence|duration|invariant", "draft": false,
                 "preconditions": ["Signal == 'Value'"], "whileConds": ["Signal == 'Value'"],
                 "trigger": {"signal": "S", "from": null, "to": "V"}, "forbidden": {"signal": "S", "from": null, "to": "V"},
                 "expect": {"signal": "S", "becomes": "V"}, "expectAll": ["Signal == 'Value'"],
                 "deadlineMs": null, "durationMs": null, "windowMs": null, "tolerancePct": null,
                 "stateSignal": null, "allowedTransitions": [], "violationTitle": null, "checkList": []}
                Rules by kind: response needs trigger+expect+deadlineMs; absence needs forbidden and whileConds
                (or trigger+windowMs); duration needs whileConds+durationMs+expect; invariant needs expectAll
                or stateSignal+allowedTransitions.
                Every predicate string is EXACTLY one "Signal op value" comparison (ops: == != < <= > >=).
                NEVER write implications ("A -> B"), "and"/"&&", or multiple comparisons in one string —
                put the condition in whileConds and the consequence in expectAll as separate strings.
                A state condition plus an expected state with no deadline ("when/while X is V, Y should be W")
                is an invariant: whileConds = the condition, expectAll = the expectation.
                Give the rule a short UNIQUE UPPERCASE id derived from the subject
                (e.g. KEY_OUT_WHEN_LOCKED), never a generic id like RULE_1.
                Use EXACT signal names AND value labels from this list when they match the sentence's intent.
                Map a described signal to a listed one ONLY when its name or value labels clearly match the
                sentence's meaning. If nothing in the list matches, keep the sentence's own wording as the
                signal name (e.g. Key_Position) — NEVER substitute an unrelated listed signal to force a fit;
                unknown names are flagged to the user as out-of-scope, which is the correct outcome.
                %s
                Examples:
                EN "When Key_Button_Status becomes Lock_Pressed, Drd_Lock must become Locked within 600 ms" ->
                {"id":"LOCK_RESPONSE","kind":"response","severity":"medium","trigger":{"signal":"Key_Button_Status","from":null,"to":"Lock_Pressed"},"expect":{"signal":"Drd_Lock","becomes":"Locked"},"deadlineMs":600}
                FR "Drd_Lock ne doit jamais passer à Unlocked tant que Vehicle_Speed est 100" ->
                {"id":"NO_UNLOCK_MOVING","kind":"absence","severity":"medium","forbidden":{"signal":"Drd_Lock","from":null,"to":"Unlocked"},"whileConds":["Vehicle_Speed == 100"]}
                EN "when door lock is locked key should be outside" ->
                {"id":"KEY_OUT_WHEN_LOCKED","kind":"invariant","severity":"medium","whileConds":["Door_Lock == 'Locked'"],"expectAll":["Key_Position == 'Outside'"]}
                """.formatted(signals.length() == 0 ? "(no catalog signals in scope)" : signals);
    }

    // ── Signal resolution against the scope ───────────────────────────────────

    private ResolvedRule resolveSignals(RuleEditDto rule, SignalContextDto scope) {
        Set<String> scopeNames = new LinkedHashSet<>();
        for (SignalOptionDto s : scope.signals()) {
            scopeNames.add(s.name());
        }
        Map<String, String> normToName = new TreeMap<>();
        for (String name : scopeNames) {
            normToName.putIfAbsent(norm(name), name);
        }

        Set<String> references = new LinkedHashSet<>();
        collectSignal(references, rule.trigger() == null ? null : rule.trigger().signal());
        collectSignal(references, rule.forbidden() == null ? null : rule.forbidden().signal());
        collectSignal(references, rule.expect() == null ? null : rule.expect().signal());
        collectSignal(references, rule.stateSignal());
        predicateSignals(references, rule.preconditions());
        predicateSignals(references, rule.whileConds());
        predicateSignals(references, rule.expectAll());

        List<SignalResolutionDto> resolutions = new ArrayList<>();
        Map<String, String> canonical = new TreeMap<>();
        for (String ref : references) {
            if (scopeNames.contains(ref)) {
                resolutions.add(new SignalResolutionDto(ref, "resolved", List.of()));
                continue;
            }
            String normMatch = normToName.get(norm(ref));
            if (normMatch != null) {
                canonical.put(ref, normMatch);
                resolutions.add(new SignalResolutionDto(ref, "resolved", List.of(normMatch)));
                continue;
            }
            List<String> candidates = scopeNames.stream()
                    .filter(name -> isFuzzyMatch(ref, name))
                    .limit(5)
                    .toList();
            resolutions.add(new SignalResolutionDto(ref,
                    candidates.isEmpty() ? "unresolved" : "fuzzy", candidates));
        }
        RuleEditDto rewritten = canonical.isEmpty()
                ? rule
                : mapSignals(rule, ref -> canonical.getOrDefault(ref, ref));
        return new ResolvedRule(rewritten, resolutions);
    }

    private static void collectSignal(Set<String> out, String signal) {
        if (signal != null && !signal.isBlank()) {
            out.add(signal.trim());
        }
    }

    private static void predicateSignals(Set<String> out, List<String> predicates) {
        if (predicates == null) {
            return;
        }
        for (String p : predicates) {
            try {
                out.add(RequirementParser.parsePredicate(p).signal());
            } catch (IllegalArgumentException ignored) {
                // Unparseable predicate is reported by validate(), not here.
            }
        }
    }

    private static String norm(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static boolean isFuzzyMatch(String ref, String scopeName) {
        String a = norm(ref);
        String b = norm(scopeName);
        if (a.isEmpty() || b.isEmpty()) {
            return false;
        }
        return a.contains(b) || b.contains(a) || levenshtein(a, b) <= 2;
    }

    private static int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] curr = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            prev[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            curr[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                curr[j] = Math.min(Math.min(curr[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] tmp = prev;
            prev = curr;
            curr = tmp;
        }
        return prev[b.length()];
    }

    // ── Record rebuilding helpers ─────────────────────────────────────────────

    /** New rule with every signal reference mapped through {@code f}. */
    private static RuleEditDto mapSignals(RuleEditDto r, UnaryOperator<String> f) {
        return new RuleEditDto(r.id(), r.title(), r.component(), r.severity(), r.kind(), r.draft(),
                mapPredicates(r.preconditions(), f), mapPredicates(r.whileConds(), f),
                mapEdge(r.trigger(), f), mapEdge(r.forbidden(), f),
                r.expect() == null ? null : new ExpectDto(f.apply(r.expect().signal()), r.expect().becomes()),
                mapPredicates(r.expectAll(), f),
                r.deadlineMs(), r.durationMs(), r.windowMs(), r.tolerancePct(),
                r.stateSignal() == null ? null : f.apply(r.stateSignal()),
                r.allowedTransitions(), r.violationTitle(), r.checkList());
    }

    private static EdgeDto mapEdge(EdgeDto e, UnaryOperator<String> f) {
        return e == null ? null : new EdgeDto(f.apply(e.signal()), e.from(), e.to());
    }

    private static List<String> mapPredicates(List<String> predicates, UnaryOperator<String> f) {
        if (predicates == null || predicates.isEmpty()) {
            return predicates;
        }
        List<String> out = new ArrayList<>();
        for (String p : predicates) {
            try {
                var parsed = RequirementParser.parsePredicate(p);
                String mapped = f.apply(parsed.signal());
                out.add(mapped.equals(parsed.signal())
                        ? p
                        : p.replaceFirst("^\\s*" + java.util.regex.Pattern.quote(parsed.signal()), mapped));
            } catch (IllegalArgumentException e) {
                out.add(p);
            }
        }
        return out;
    }

    private static RuleEditDto withDraft(RuleEditDto r) {
        return new RuleEditDto(r.id(), r.title(), r.component(), r.severity(), r.kind(), true,
                r.preconditions(), r.whileConds(), r.trigger(), r.forbidden(), r.expect(),
                r.expectAll(), r.deadlineMs(), r.durationMs(), r.windowMs(), r.tolerancePct(),
                r.stateSignal(), r.allowedTransitions(), r.violationTitle(), r.checkList());
    }

    private static RuleEditDto withId(RuleEditDto r, String id) {
        if (r == null) {
            throw new IllegalArgumentException("JSON does not match the rule schema");
        }
        return new RuleEditDto(id, r.title(), r.component(), r.severity(), r.kind(), r.draft(),
                r.preconditions(), r.whileConds(), r.trigger(), r.forbidden(), r.expect(),
                r.expectAll(), r.deadlineMs(), r.durationMs(), r.windowMs(), r.tolerancePct(),
                r.stateSignal(), r.allowedTransitions(), r.violationTitle(), r.checkList());
    }

    /** A rule is valid when it survives the same parser that guards saves. */
    private static void validate(RuleEditDto rule) {
        RequirementParser.parse("nl-preview.yaml",
                RequirementYamlEditor.addRule(RequirementYamlEditor.newFile("nl-preview"), rule));
    }

    private static double clamp(double v) {
        return Math.max(0.1, Math.min(1.0, v));
    }
}
