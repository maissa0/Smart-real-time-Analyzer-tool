package com.example.backend.can.service;

import com.example.backend.can.dto.RequirementDtos.NlConvertRequest;
import com.example.backend.can.dto.RequirementDtos.NlConvertResponse;
import com.example.backend.can.dto.RequirementDtos.SignalContextDto;
import com.example.backend.can.dto.RequirementDtos.SignalOptionDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Phase C tests: engine selection, canned-Groq-output validation with retry,
 * and signal resolution (canonicalization, fuzzy, unresolved -> draft).
 */
class RequirementNlServiceTest {

    private static final String VALID_LLM_JSON = """
            {"id":"NL_1","title":"lock response","kind":"response","severity":"medium",
             "trigger":{"signal":"Key_Button_Status","from":null,"to":"Lock_Pressed"},
             "expect":{"signal":"Drd_Lock","becomes":"Locked"},"deadlineMs":600}
            """;
    private static final String INVALID_LLM_JSON = """
            {"id":"NL_1","kind":"response","severity":"medium",
             "trigger":{"signal":"Key_Button_Status","to":"Lock_Pressed"}}
            """;

    private GroqClient groqClient;
    private RequirementService requirementService;
    private RequirementNlService service;

    @BeforeEach
    void setUp() {
        groqClient = mock(GroqClient.class);
        requirementService = mock(RequirementService.class);
        service = new RequirementNlService(groqClient, requirementService, new ObjectMapper());
        SignalContextDto scope = new SignalContextDto("s.yaml", true, List.of(
                new SignalOptionDto("Drd_Lock", "DOOR", "car.xml", List.of("Locked", "Unlocked")),
                new SignalOptionDto("Key_Button_Status", "KEY", "car.xml", List.of("Lock_Pressed")),
                new SignalOptionDto("Vehicle_Speed", "SPEED", "car.xml", List.of())));
        when(requirementService.signalContext(any(), any())).thenReturn(scope);
    }

    private NlConvertResponse convert(String text) {
        return service.convert(new NlConvertRequest(text, "s.yaml", null, null, null));
    }

    private NlConvertResponse convertBulk(String text) {
        return service.convert(new NlConvertRequest(text, "s.yaml", null, null, "bulk"));
    }

    @Test
    @DisplayName("no API key -> local parser answers, engine PARSER, names canonicalized")
    void parserFallback_canonicalizes() {
        NlConvertResponse res = convert("drd_lock must stay Locked for 1000 ms");

        assertEquals("PARSER", res.engine());
        assertTrue(res.warnings().stream().anyMatch(w -> w.contains("not configured")));
        assertEquals(1, res.drafts().size());
        var draft = res.drafts().get(0);
        // "drd_lock" resolved (normalized) to the catalog spelling everywhere.
        assertEquals("Drd_Lock", draft.rule().expect().signal());
        assertEquals("Drd_Lock == 'Locked'", draft.rule().whileConds().get(0));
        assertTrue(draft.signals().stream()
                .allMatch(r -> "resolved".equals(r.status())));
    }

    @Test
    @DisplayName("unknown signal -> unresolved, rule forced to draft, low confidence")
    void unresolved_forcesDraft() {
        NlConvertResponse res = convert("Ghost_Thing is always 1");

        var draft = res.drafts().get(0);
        assertTrue(draft.rule().draft());
        assertEquals("unresolved", draft.signals().get(0).status());
        assertTrue(draft.confidence() < 0.8);
        assertTrue(res.warnings().stream().anyMatch(w -> w.contains("draft")));
    }

    @Test
    @DisplayName("canned valid Groq output -> engine LLM, rule mapped and validated")
    void llm_validOutput() {
        ReflectionTestUtils.setField(service, "groqApiKey", "test-key");
        when(groqClient.complete(anyString(), anyString())).thenReturn(VALID_LLM_JSON);

        NlConvertResponse res = convert("When the lock button is pressed, the doors must lock quickly");

        assertEquals("LLM", res.engine());
        var rule = res.drafts().get(0).rule();
        assertEquals("response", rule.kind());
        assertEquals(600L, rule.deadlineMs());
        assertEquals("Drd_Lock", rule.expect().signal());
        verify(groqClient, times(1)).complete(anyString(), anyString());
    }

    @Test
    @DisplayName("invalid Groq output -> one retry with the validation error, then success")
    void llm_invalidThenRetry() {
        ReflectionTestUtils.setField(service, "groqApiKey", "test-key");
        when(groqClient.complete(anyString(), anyString()))
                .thenReturn(INVALID_LLM_JSON)
                .thenReturn(VALID_LLM_JSON);

        NlConvertResponse res = convert("When the lock button is pressed, the doors must lock quickly");

        assertEquals("LLM", res.engine());
        assertEquals(600L, res.drafts().get(0).rule().deadlineMs());
        verify(groqClient, times(2)).complete(anyString(), anyString());
    }

    @Test
    @DisplayName("Groq invalid twice -> falls back to the local parser with a warning")
    void llm_twiceInvalid_fallsBack() {
        ReflectionTestUtils.setField(service, "groqApiKey", "test-key");
        when(groqClient.complete(anyString(), anyString())).thenReturn(INVALID_LLM_JSON);

        NlConvertResponse res = convert("Drd_Lock must stay Locked for 1000 ms");

        assertEquals("PARSER", res.engine());
        assertTrue(res.warnings().stream().anyMatch(w -> w.contains("LLM conversion failed")));
        assertEquals("duration", res.drafts().get(0).rule().kind());
    }

    @Test
    @DisplayName("bulk without a configured LLM -> empty drafts + unavailable warning")
    void bulk_withoutLlm_unavailable() {
        NlConvertResponse res = convertBulk("doc with many requirements");

        assertTrue(res.drafts().isEmpty());
        assertTrue(res.warnings().stream()
                .anyMatch(w -> w.contains("Bulk conversion requires")));
    }

    @Test
    @DisplayName("bulk canned Groq output -> one draft per valid rule, invalid ones skipped")
    void bulk_cannedOutput() {
        ReflectionTestUtils.setField(service, "groqApiKey", "test-key");
        when(groqClient.complete(anyString(), anyString())).thenReturn("""
                {"rules":[
                  {"id":"B1","kind":"response","severity":"medium","source":"sentence one",
                   "trigger":{"signal":"Key_Button_Status","to":"Lock_Pressed"},
                   "expect":{"signal":"Drd_Lock","becomes":"Locked"},"deadlineMs":600},
                  {"id":"B2","kind":"response","severity":"medium","source":"sentence two",
                   "trigger":{"signal":"Key_Button_Status","to":"Lock_Pressed"}}
                ]}
                """);

        NlConvertResponse res = convertBulk("two requirements pasted as a document");

        assertEquals("LLM", res.engine());
        assertEquals(1, res.drafts().size());
        assertEquals("B1", res.drafts().get(0).rule().id());
        assertEquals("sentence one", res.drafts().get(0).source());
        assertTrue(res.warnings().stream()
                .anyMatch(w -> w.contains("Skipped requirement 2")));
    }

    @Test
    @DisplayName("unrecognized sentence and no LLM -> empty drafts with guidance")
    void unrecognized_returnsGuidance() {
        NlConvertResponse res = convert("hello world");

        assertTrue(res.drafts().isEmpty());
        assertTrue(res.warnings().stream().anyMatch(w -> w.contains("Sentence not recognized")));
    }
}
