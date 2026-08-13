package com.example.backend.can.requirements;

import com.example.backend.can.dto.RequirementDtos.EdgeDto;
import com.example.backend.can.dto.RequirementDtos.ExpectDto;
import com.example.backend.can.dto.RequirementDtos.RuleEditDto;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic single-sentence requirement parser (Phase C fallback when the
 * LLM is not configured or unreachable). English + French, one sentence -> one
 * rule; anything it does not recognise returns empty so the caller can warn.
 *
 * Supported shapes (EN / FR):
 * - response:  "when X becomes V, Y must become W within N ms"
 *              "quand X passe à V, Y doit passer à W en N ms"
 * - absence:   "X must never become V while Y is W"
 *              "X ne doit jamais passer à V tant que Y est W"
 * - duration:  "X must stay V for N ms" / "X doit rester V pendant N ms"
 * - invariant: "X is always V" / "X est toujours V"
 */
public final class RequirementSentenceParser {

    private static final int F = Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;

    private static final Pattern RESPONSE_EN = Pattern.compile(
            "^(?:when|if)\\s+(\\S+)\\s+(?:becomes|is set to|goes to|changes to|switches to)\\s+(.+?)\\s*,\\s*"
            + "(\\S+)\\s+must\\s+(?:become|be|go to|change to|switch to)\\s+(.+?)\\s+within\\s+(\\d+)\\s*ms\\.?$", F);
    private static final Pattern RESPONSE_FR = Pattern.compile(
            "^(?:quand|lorsque|si)\\s+(\\S+)\\s+(?:passe à|devient|est mis à|est mise à)\\s+(.+?)\\s*,\\s*"
            + "(\\S+)\\s+doit\\s+(?:passer à|devenir|être)\\s+(.+?)\\s+(?:en|dans les|sous)\\s+(\\d+)\\s*ms\\.?$", F);

    private static final Pattern ABSENCE_EN = Pattern.compile(
            "^(\\S+)\\s+must\\s+never\\s+(?:become|be|go to)\\s+(.+?)\\s+(?:while|when|as long as)\\s+(.+?)\\.?$", F);
    private static final Pattern ABSENCE_FR = Pattern.compile(
            "^(\\S+)\\s+ne\\s+doit\\s+jamais\\s+(?:passer à|devenir|être)\\s+(.+?)\\s+(?:tant que|quand|lorsque)\\s+(.+?)\\.?$", F);

    private static final Pattern DURATION_EN = Pattern.compile(
            "^(\\S+)\\s+must\\s+(?:stay|remain)\\s+(.+?)\\s+for\\s+(?:at least\\s+)?(\\d+)\\s*ms\\.?$", F);
    private static final Pattern DURATION_FR = Pattern.compile(
            "^(\\S+)\\s+doit\\s+rester\\s+(.+?)\\s+pendant\\s+(?:au moins\\s+)?(\\d+)\\s*ms\\.?$", F);

    private static final Pattern INVARIANT_EN = Pattern.compile(
            "^(\\S+)\\s+(?:is\\s+always|must\\s+always\\s+be)\\s+(.+?)\\.?$", F);
    private static final Pattern INVARIANT_FR = Pattern.compile(
            "^(\\S+)\\s+(?:est\\s+toujours|doit\\s+toujours\\s+être)\\s+(.+?)\\.?$", F);

    /** One "Y is W" / "Y est W" level condition inside an absence sentence. */
    private static final Pattern CONDITION = Pattern.compile(
            "^(\\S+)\\s+(?:is|equals|est|vaut|==)\\s+(.+?)$", F);

    private RequirementSentenceParser() {
    }

    /** Empty when no pattern matches — caller falls back to a warning. */
    public static Optional<RuleEditDto> parse(String sentence) {
        String s = sentence == null ? "" : sentence.trim();
        if (s.isEmpty()) {
            return Optional.empty();
        }
        Matcher m;
        if ((m = RESPONSE_EN.matcher(s)).matches() || (m = RESPONSE_FR.matcher(s)).matches()) {
            return Optional.of(response(s, m.group(1), value(m.group(2)),
                    m.group(3), value(m.group(4)), Long.parseLong(m.group(5))));
        }
        if ((m = ABSENCE_EN.matcher(s)).matches() || (m = ABSENCE_FR.matcher(s)).matches()) {
            List<String> conditions = conditions(m.group(3));
            if (conditions.isEmpty()) {
                return Optional.empty();
            }
            return Optional.of(absence(s, m.group(1), value(m.group(2)), conditions));
        }
        if ((m = DURATION_EN.matcher(s)).matches() || (m = DURATION_FR.matcher(s)).matches()) {
            return Optional.of(duration(s, m.group(1), value(m.group(2)),
                    Long.parseLong(m.group(3))));
        }
        if ((m = INVARIANT_EN.matcher(s)).matches() || (m = INVARIANT_FR.matcher(s)).matches()) {
            return Optional.of(invariant(s, m.group(1), value(m.group(2))));
        }
        return Optional.empty();
    }

    // ── Rule builders ─────────────────────────────────────────────────────────

    private static RuleEditDto response(String title, String triggerSignal, String triggerValue,
                                        String expectSignal, String expectValue, long deadlineMs) {
        return new RuleEditDto("NL_RESPONSE", title, null, "medium", "response", false,
                List.of(), List.of(),
                new EdgeDto(triggerSignal, null, triggerValue), null,
                new ExpectDto(expectSignal, expectValue), List.of(),
                deadlineMs, null, null, null, null, List.of(), null, List.of());
    }

    private static RuleEditDto absence(String title, String forbiddenSignal, String forbiddenValue,
                                       List<String> whileConds) {
        return new RuleEditDto("NL_ABSENCE", title, null, "medium", "absence", false,
                List.of(), whileConds,
                null, new EdgeDto(forbiddenSignal, null, forbiddenValue), null, List.of(),
                null, null, null, null, null, List.of(), null, List.of());
    }

    private static RuleEditDto duration(String title, String signal, String value, long durationMs) {
        return new RuleEditDto("NL_DURATION", title, null, "medium", "duration", false,
                List.of(), List.of(predicate(signal, value)),
                null, null, new ExpectDto(signal, value), List.of(),
                null, durationMs, null, null, null, List.of(), null, List.of());
    }

    private static RuleEditDto invariant(String title, String signal, String value) {
        return new RuleEditDto("NL_INVARIANT", title, null, "medium", "invariant", false,
                List.of(), List.of(), null, null, null,
                List.of(predicate(signal, value)),
                null, null, null, null, null, List.of(), null, List.of());
    }

    // ── Fragments ─────────────────────────────────────────────────────────────

    /** Split "Y is W and Z is Q" / "Y est W et Z est Q" into predicate strings. */
    private static List<String> conditions(String text) {
        List<String> out = new ArrayList<>();
        for (String part : text.split("(?i)\\s+(?:and|et)\\s+")) {
            Matcher c = CONDITION.matcher(part.trim());
            if (!c.matches()) {
                return List.of(); // one unparseable condition -> whole sentence fails
            }
            out.add(predicate(c.group(1), value(c.group(2))));
        }
        return out;
    }

    private static String predicate(String signal, String value) {
        return signal + " == " + quote(value);
    }

    /** Numbers stay bare; anything else single-quoted for the predicate parser. */
    private static String quote(String v) {
        try {
            Double.parseDouble(v);
            return v;
        } catch (NumberFormatException e) {
            return "'" + v.replace("'", "") + "'";
        }
    }

    /** Strip quotes and trailing punctuation from a captured value. */
    private static String value(String raw) {
        String v = raw.trim();
        if (v.length() >= 2 && ((v.startsWith("'") && v.endsWith("'"))
                || (v.startsWith("\"") && v.endsWith("\"")))) {
            v = v.substring(1, v.length() - 1);
        }
        return v.trim();
    }

    /** Locale hint is accepted for API symmetry; detection is pattern-driven. */
    public static String normalizeLanguage(String language) {
        return language == null ? "auto" : language.toLowerCase(Locale.ROOT);
    }
}
