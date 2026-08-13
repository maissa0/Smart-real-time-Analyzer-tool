package com.example.backend.can.requirements;

import com.example.backend.can.requirements.RequirementModel.Op;
import com.example.backend.can.requirements.RequirementModel.Predicate;
import com.example.backend.can.requirements.RequirementModel.RequirementFile;
import com.example.backend.can.requirements.RequirementModel.RuleKind;
import com.example.backend.can.requirements.RequirementModel.Severity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RequirementParserTest {

    private static final String VALID = """
            meta:
              name: Test set
              version: 2
              signal_map: { KEY_Pos: KEY_Pos }
              derived_signals:
                - name: car_state
                  from: [Led_Status]
                  cases:
                    - value: unlocked
                      when: ["Led_Status == 'green'"]
            rules:
              - id: R1
                kind: response
                severity: high
                preconditions: ["KEY_Pos == 'Outside'", "KEY_Butt in [1000, 45896567]"]
                trigger: { signal: Key_Button_Status, to: 'Lock_Pressed' }
                expect: { signal: car_state, becomes: 'secured' }
                deadline_ms: 600
                tolerance_pct: 10
              - id: R2
                kind: absence
                while: ["car_state == 'secured'"]
                forbidden: { signal: Drd_Status, to: 'Open' }
              - id: R3
                kind: duration
                state: ["car_state == 'unlocked'"]
                duration_ms: 120000
                expect: { signal: car_state, becomes: 'locked' }
              - id: R4
                kind: invariant
                state_signal: car_state
                allowed_transitions: [[unlocked, secured], [secured, unlocked]]
              - id: R5
                kind: invariant
                draft: true
                when: ["car_state == 'unlocked'"]
                expect_all: ["Led_Status == 'green'"]
            """;

    @Test
    @DisplayName("valid file parses with all four rule kinds")
    void parse_validFile_allKinds() {
        RequirementFile f = RequirementParser.parse("test.yaml", VALID);

        assertEquals("Test set", f.name());
        assertEquals("2", f.version());
        assertEquals(5, f.ruleCount());
        assertEquals(1, f.draftCount());
        assertEquals(1, f.derivedSignals().size());

        var r1 = f.rules().get(0);
        assertEquals(RuleKind.RESPONSE, r1.kind());
        assertEquals(Severity.HIGH, r1.severity());
        assertEquals(660, r1.effectiveDeadlineMs()); // 600ms + 10%
        assertEquals(2, r1.preconditions().size());
        assertEquals("Lock_Pressed", r1.trigger().to());
        assertNull(r1.trigger().from());

        assertEquals(RuleKind.ABSENCE, f.rules().get(1).kind());
        assertEquals(RuleKind.DURATION, f.rules().get(2).kind());
        assertEquals(2, f.rules().get(3).allowedTransitions().size());
        assertTrue(f.rules().get(4).draft());
    }

    @Test
    @DisplayName("predicate parsing covers all operators")
    void parsePredicate_operators() {
        Predicate eq = RequirementParser.parsePredicate("KEY_Pos == 'Outside'");
        assertEquals(Op.EQ, eq.op());
        assertEquals("Outside", eq.values().get(0));

        Predicate in = RequirementParser.parsePredicate("KEY_Butt in [1000, 45896567]");
        assertEquals(Op.IN, in.op());
        assertEquals(2, in.values().size());

        assertEquals(Op.GE, RequirementParser.parsePredicate("speed >= 30").op());
        assertEquals(Op.NE, RequirementParser.parsePredicate("x != 1").op());
    }

    @Test
    @DisplayName("garbage predicates are rejected")
    void parsePredicate_garbage_throws() {
        assertThrows(IllegalArgumentException.class,
                () -> RequirementParser.parsePredicate("not a predicate at all!"));
        assertThrows(IllegalArgumentException.class,
                () -> RequirementParser.parsePredicate("x in notalist"));
    }

    @Test
    @DisplayName("missing required fields fail with the rule id in the message")
    void parse_missingFields_rejected() {
        String missingDeadline = """
                rules:
                  - id: BAD_1
                    kind: response
                    trigger: { signal: A, to: 'x' }
                    expect: { signal: B, becomes: 'y' }
                """;
        // no meta at all is also invalid
        assertThrows(IllegalArgumentException.class,
                () -> RequirementParser.parse("t.yaml", missingDeadline));

        String withMeta = "meta: {name: t}\n" + missingDeadline;
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> RequirementParser.parse("t.yaml", withMeta));
        assertTrue(e.getMessage().contains("BAD_1"));
        assertTrue(e.getMessage().contains("deadline_ms"));
    }

    @Test
    @DisplayName("duplicate rule ids are rejected")
    void parse_duplicateIds_rejected() {
        String dup = """
                meta: {name: t}
                rules:
                  - id: R1
                    kind: absence
                    while: ["a == 1"]
                    forbidden: { signal: b, to: 'x' }
                  - id: R1
                    kind: absence
                    while: ["a == 2"]
                    forbidden: { signal: b, to: 'y' }
                """;
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> RequirementParser.parse("t.yaml", dup));
        assertTrue(e.getMessage().contains("Duplicate rule id"));
    }

    @Test
    @DisplayName("invalid YAML syntax is rejected, not thrown raw")
    void parse_invalidYaml_rejected() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> RequirementParser.parse("t.yaml", "rules: [unclosed"));
        assertTrue(e.getMessage().startsWith("Invalid YAML")
                || e.getMessage().contains("mapping"));
    }
}
