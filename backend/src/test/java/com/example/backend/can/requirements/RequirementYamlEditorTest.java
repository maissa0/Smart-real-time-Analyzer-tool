package com.example.backend.can.requirements;

import com.example.backend.can.dto.RequirementDtos.DerivedCaseEditDto;
import com.example.backend.can.dto.RequirementDtos.DerivedSignalEditDto;
import com.example.backend.can.dto.RequirementDtos.EdgeDto;
import com.example.backend.can.dto.RequirementDtos.ExpectDto;
import com.example.backend.can.dto.RequirementDtos.MetaUpdateDto;
import com.example.backend.can.dto.RequirementDtos.RuleEditDto;
import com.example.backend.can.requirements.RequirementModel.RequirementFile;
import com.example.backend.can.requirements.RequirementModel.RuleKind;
import com.example.backend.can.requirements.RequirementModel.Severity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for the structured YAML mutations (Phase A of
 * docs/REQUIREMENTS_AUTHORING_PLAN.md). Every mutated result must round-trip
 * through {@link RequirementParser} — the same validation the service applies
 * before writing to disk.
 */
class RequirementYamlEditorTest {

    private static RuleEditDto responseRule(String id) {
        return new RuleEditDto(id, "Lock responds", "BCM", "high", "response", false,
                List.of("KEY_Pos == 'Outside'"), List.of(),
                new EdgeDto("Key_Button_Status", null, "Lock_Pressed"), null,
                new ExpectDto("Drd_Lock", "Locked"), List.of(),
                600L, null, null, 10.0, null, List.of(), null, List.of("Check wiring"));
    }

    @Test
    @DisplayName("newFile produces a valid empty file with meta")
    void newFile_valid() {
        String yaml = RequirementYamlEditor.newFile("My set");
        RequirementFile f = RequirementParser.parse("new.yaml", yaml);
        assertEquals("My set", f.name());
        assertEquals("1", f.version());
        assertEquals(0, f.ruleCount());
    }

    @Test
    @DisplayName("addRule appends a parseable rule with all fields")
    void addRule_appends() {
        String yaml = RequirementYamlEditor.addRule(
                RequirementYamlEditor.newFile("T"), responseRule("R1"));
        RequirementFile f = RequirementParser.parse("t.yaml", yaml);

        assertEquals(1, f.ruleCount());
        var r = f.rules().get(0);
        assertEquals("R1", r.id());
        assertEquals(RuleKind.RESPONSE, r.kind());
        assertEquals(Severity.HIGH, r.severity());
        assertEquals("Lock_Pressed", r.trigger().to());
        assertEquals("Locked", r.expect().becomes());
        assertEquals(600L, r.deadlineMs());
        assertEquals(1, r.preconditions().size());
        assertEquals(List.of("Check wiring"), r.checkList());
    }

    @Test
    @DisplayName("while-conditions are written under the kind's alias key")
    void addRule_whileAliasPerKind() {
        RuleEditDto duration = new RuleEditDto("D1", null, null, "medium", "duration", false,
                List.of(), List.of("car_state == 'unlocked'"), null, null,
                new ExpectDto("car_state", "locked"), List.of(),
                null, 120000L, null, null, null, List.of(), null, List.of());
        String yaml = RequirementYamlEditor.addRule(RequirementYamlEditor.newFile("T"), duration);
        assertTrue(yaml.contains("state:"), "duration rules should use the 'state' alias");
        assertEquals(1, RequirementParser.parse("t.yaml", yaml)
                .rules().get(0).whileConds().size());
    }

    @Test
    @DisplayName("invariant transition form serializes as [from, to] pairs")
    void addRule_invariantTransitions() {
        RuleEditDto invariant = new RuleEditDto("I1", null, null, "critical", "invariant", false,
                List.of(), List.of(), null, null, null, List.of(),
                null, null, null, null, "car_state",
                List.of(List.of("unlocked", "secured"), List.of("secured", "unlocked")),
                null, List.of());
        String yaml = RequirementYamlEditor.addRule(RequirementYamlEditor.newFile("T"), invariant);
        var r = RequirementParser.parse("t.yaml", yaml).rules().get(0);
        assertEquals("car_state", r.stateSignal());
        assertEquals(2, r.allowedTransitions().size());
        assertEquals("secured", r.allowedTransitions().get(0).to());
    }

    @Test
    @DisplayName("updateRule replaces in place and may rename the id")
    void updateRule_replacesAndRenames() {
        String yaml = RequirementYamlEditor.addRule(
                RequirementYamlEditor.newFile("T"), responseRule("R1"));
        RuleEditDto renamed = responseRule("R2");
        String updated = RequirementYamlEditor.updateRule(yaml, "R1", renamed);
        RequirementFile f = RequirementParser.parse("t.yaml", updated);
        assertEquals(1, f.ruleCount());
        assertEquals("R2", f.rules().get(0).id());
    }

    @Test
    @DisplayName("updateRule on an unknown id throws")
    void updateRule_unknownId_throws() {
        String yaml = RequirementYamlEditor.newFile("T");
        assertThrows(IllegalArgumentException.class,
                () -> RequirementYamlEditor.updateRule(yaml, "NOPE", responseRule("R1")));
    }

    @Test
    @DisplayName("deleteRule removes the rule; the last rule may be deleted")
    void deleteRule_removes() {
        String yaml = RequirementYamlEditor.addRule(
                RequirementYamlEditor.newFile("T"), responseRule("R1"));
        String afterDelete = RequirementYamlEditor.deleteRule(yaml, "R1");
        assertEquals(0, RequirementParser.parse("t.yaml", afterDelete).ruleCount());
        assertThrows(IllegalArgumentException.class,
                () -> RequirementYamlEditor.deleteRule(afterDelete, "R1"));
    }

    @Test
    @DisplayName("updateMeta replaces name, signal_map and derived_signals")
    void updateMeta_replacesSections() {
        String yaml = RequirementYamlEditor.addRule(
                RequirementYamlEditor.newFile("Old name"), responseRule("R1"));
        MetaUpdateDto meta = new MetaUpdateDto("New name", "3",
                Map.of("KEY", "Key_Button_Status"),
                List.of(new DerivedSignalEditDto("car_state", List.of("Drd_Lock"),
                        List.of(new DerivedCaseEditDto("secured", List.of("Drd_Lock == 'Locked'"))))));
        RequirementFile f = RequirementParser.parse("t.yaml",
                RequirementYamlEditor.updateMeta(yaml, meta));

        assertEquals("New name", f.name());
        assertEquals("3", f.version());
        assertEquals("Key_Button_Status", f.signalMap().get("KEY"));
        assertEquals(1, f.derivedSignals().size());
        assertEquals("secured", f.derivedSignals().get(0).cases().get(0).value());
        assertEquals(1, f.ruleCount()); // rules untouched
    }

    @Test
    @DisplayName("updateMeta with empty signal_map removes the key")
    void updateMeta_emptyMapRemoves() {
        String yaml = RequirementYamlEditor.updateMeta(
                RequirementYamlEditor.newFile("T"),
                new MetaUpdateDto(null, null, Map.of("A", "B"), List.of()));
        assertTrue(yaml.contains("signal_map"));
        String cleared = RequirementYamlEditor.updateMeta(yaml,
                new MetaUpdateDto(null, null, Map.of(), List.of()));
        assertTrue(!cleared.contains("signal_map"));
    }

    @Test
    @DisplayName("unknown top-level keys survive a mutation round-trip")
    void unknownKeys_preserved() {
        String yaml = RequirementYamlEditor.newFile("T") + "\ncustom_note: keep me\n";
        String mutated = RequirementYamlEditor.addRule(yaml, responseRule("R1"));
        assertTrue(mutated.contains("custom_note"));
    }

    @Test
    @DisplayName("empty rules list is now valid for the parser (created files start empty)")
    void parser_acceptsEmptyRules() {
        assertEquals(0, RequirementParser.parse("t.yaml", "meta: {name: T}\nrules: []\n").ruleCount());
        assertEquals(0, RequirementParser.parse("t.yaml", "meta: {name: T}\n").ruleCount());
    }
}
