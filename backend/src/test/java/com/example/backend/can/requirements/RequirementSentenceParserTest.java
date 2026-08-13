package com.example.backend.can.requirements;

import com.example.backend.can.dto.RequirementDtos.RuleEditDto;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** EN + FR sentence -> rule tests for the Phase C fallback parser. */
class RequirementSentenceParserTest {

    private static RuleEditDto parsed(String sentence) {
        Optional<RuleEditDto> rule = RequirementSentenceParser.parse(sentence);
        assertTrue(rule.isPresent(), "should parse: " + sentence);
        return rule.get();
    }

    @Test
    @DisplayName("EN response: when X becomes V, Y must become W within N ms")
    void response_en() {
        RuleEditDto r = parsed(
                "When Key_Button_Status becomes Lock_Pressed, Drd_Lock must become Locked within 600 ms");
        assertEquals("response", r.kind());
        assertEquals("Key_Button_Status", r.trigger().signal());
        assertEquals("Lock_Pressed", r.trigger().to());
        assertEquals("Drd_Lock", r.expect().signal());
        assertEquals("Locked", r.expect().becomes());
        assertEquals(600L, r.deadlineMs());
    }

    @Test
    @DisplayName("FR response: quand X passe à V, Y doit passer à W en N ms")
    void response_fr() {
        RuleEditDto r = parsed(
                "Quand Key_Button_Status passe à Lock_Pressed, Drd_Lock doit passer à Locked en 600 ms");
        assertEquals("response", r.kind());
        assertEquals("Lock_Pressed", r.trigger().to());
        assertEquals(600L, r.deadlineMs());
    }

    @Test
    @DisplayName("EN absence with two while-conditions joined by 'and'")
    void absence_en() {
        RuleEditDto r = parsed(
                "Drd_Lock must never become Unlocked while Vehicle_Speed is 100 and KEY_Pos is Outside");
        assertEquals("absence", r.kind());
        assertEquals("Drd_Lock", r.forbidden().signal());
        assertEquals("Unlocked", r.forbidden().to());
        assertEquals(2, r.whileConds().size());
        assertEquals("Vehicle_Speed == 100", r.whileConds().get(0));
        assertEquals("KEY_Pos == 'Outside'", r.whileConds().get(1));
    }

    @Test
    @DisplayName("FR absence: ne doit jamais passer à ... tant que ...")
    void absence_fr() {
        RuleEditDto r = parsed(
                "Drd_Lock ne doit jamais passer à Unlocked tant que Vehicle_Speed est 100");
        assertEquals("absence", r.kind());
        assertEquals("Unlocked", r.forbidden().to());
        assertEquals("Vehicle_Speed == 100", r.whileConds().get(0));
    }

    @Test
    @DisplayName("EN + FR duration: must stay / doit rester ... for/pendant N ms")
    void duration_enFr() {
        RuleEditDto en = parsed("Drd_Lock must stay Locked for 120000 ms");
        assertEquals("duration", en.kind());
        assertEquals(120000L, en.durationMs());
        assertEquals("Drd_Lock == 'Locked'", en.whileConds().get(0));
        assertEquals("Locked", en.expect().becomes());

        RuleEditDto fr = parsed("Drd_Lock doit rester Locked pendant 120000 ms");
        assertEquals("duration", fr.kind());
        assertEquals(120000L, fr.durationMs());
    }

    @Test
    @DisplayName("EN + FR invariant: is always / est toujours")
    void invariant_enFr() {
        RuleEditDto en = parsed("Backdoor_Status is always Closed");
        assertEquals("invariant", en.kind());
        assertEquals("Backdoor_Status == 'Closed'", en.expectAll().get(0));

        RuleEditDto fr = parsed("Backdoor_Status est toujours Closed");
        assertEquals("invariant", fr.kind());
    }

    @Test
    @DisplayName("every parsed rule survives the strict requirement parser")
    void parsedRules_areValid() {
        String[] sentences = {
                "When A becomes 1, B must become 2 within 500 ms",
                "A must never become 1 while B is 2",
                "A must stay 1 for 1000 ms",
                "A is always 1",
        };
        for (String s : sentences) {
            RuleEditDto r = parsed(s);
            RequirementParser.parse("t.yaml",
                    RequirementYamlEditor.addRule(RequirementYamlEditor.newFile("t"), r));
        }
    }

    @Test
    @DisplayName("unrecognized sentences return empty")
    void unrecognized_returnsEmpty() {
        assertTrue(RequirementSentenceParser.parse("this is not a requirement").isEmpty());
        assertTrue(RequirementSentenceParser.parse("").isEmpty());
        assertTrue(RequirementSentenceParser
                .parse("X must never become V while garbage garbage").isEmpty());
    }
}
