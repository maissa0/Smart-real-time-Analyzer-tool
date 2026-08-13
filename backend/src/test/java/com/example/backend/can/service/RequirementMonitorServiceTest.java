package com.example.backend.can.service;

import com.example.backend.can.dto.RequirementDtos.RequirementReportDto;
import com.example.backend.can.dto.RequirementDtos.RuleReportDto;
import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.requirements.RequirementParser;
import com.example.backend.can.requirements.RequirementModel.RequirementFile;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Phase-2 engine behaviour through RequirementMonitorService.onFrame() —
 * pure JUnit + Mockito, no Spring context. Frames are synthetic; the rule set
 * is an inline YAML parsed by the real RequirementParser, so these tests also
 * pin the parser->engine contract (signal_map, derived signals, draft flag).
 */
class RequirementMonitorServiceTest {

    private static final String SESSION = "sess-1";
    private static final long CAR_ID = 7L;
    private static final String FILE = "test_requirements.yaml";
    private static final double T0 = 1_700_000_000.0;

    private static final String RULES_YAML = """
            meta:
              name: Engine test set
              derived_signals:
                - name: car_state
                  from: [Led_Status]
                  cases:
                    - value: unlocked
                      when: ["Led_Status == 'green'"]
                    - value: secured
                      when: ["Led_Status == 'red'"]
            rules:
              - id: R_RESP
                title: Secure on lock press
                severity: HIGH
                kind: response
                preconditions: ["KEY_Pos == 'Outside'"]
                trigger: { signal: Btn, to: 'Pressed' }
                expect: { signal: car_state, becomes: 'secured' }
                deadline_ms: 600
                tolerance_pct: 10
                violation_title: "Car did not secure after lock press"
                check_list: ["Key fob battery"]
              - id: R_ABS
                title: No state change while key unknown
                severity: CRITICAL
                kind: absence
                while: ["KEY_Pos == 'Unknown'"]
                forbidden: { signal: car_state, from: '*' }
              - id: R_SM
                title: Allowed state transitions
                severity: HIGH
                kind: invariant
                state_signal: car_state
                allowed_transitions:
                  - [unlocked, secured]
              - id: R_DRAFT
                title: Draft response rule
                severity: MEDIUM
                kind: response
                draft: true
                trigger: { signal: Btn, to: 'Pressed' }
                expect: { signal: car_state, becomes: 'secured' }
                deadline_ms: 100
            """;

    private CanSessionRepository sessionRepository;
    private CarRepository carRepository;
    private IntegrityFaultRepository faultRepository;
    private RequirementLoaderService loaderService;
    private FindingCorrelationService correlationService;
    private DiagnosticKbService kbService;
    private RequirementMonitorService service;

    private final AtomicLong idSequence = new AtomicLong(1);

    @BeforeEach
    void setUp() {
        sessionRepository = mock(CanSessionRepository.class);
        carRepository = mock(CarRepository.class);
        faultRepository = mock(IntegrityFaultRepository.class);
        loaderService = mock(RequirementLoaderService.class);

        RequirementFile parsed = RequirementParser.parse(FILE, RULES_YAML);
        when(sessionRepository.findBySessionId(SESSION)).thenReturn(
                Optional.of(CanSessionEntity.builder().sessionId(SESSION).carId(CAR_ID).build()));
        when(carRepository.findRequirementFilenamesByCarId(CAR_ID)).thenReturn(List.of(FILE));
        when(loaderService.snapshotFor(List.of(FILE))).thenReturn(Map.of(FILE, parsed));
        when(faultRepository.save(any(IntegrityFaultEntity.class))).thenAnswer(invocation -> {
            IntegrityFaultEntity entity = invocation.getArgument(0);
            entity.setId(idSequence.getAndIncrement());
            return entity;
        });

        correlationService = mock(FindingCorrelationService.class);
        kbService = mock(DiagnosticKbService.class);
        service = new RequirementMonitorService(loaderService, sessionRepository,
                carRepository, faultRepository, correlationService, kbService,
                new ObjectMapper());
    }

    // ── Scenarios ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("response rule passes when the expected state arrives within the deadline")
    void responseRule_expectedStateInTime_passes() {
        feedBaseline();                                       // Outside / Idle / green
        feed(T0 + 1.0, sig("Btn", 2, "Pressed"));             // trigger, preconditions hold
        feed(T0 + 1.3, sig("Led_Status", 3, "red"));          // secured after 300ms (< 660ms)

        RuleReportDto row = reportRow("R_RESP");
        assertThat(row.outcome()).isEqualTo("PASS");
        assertThat(row.passCount()).isEqualTo(1);
        // legal unlocked->secured transition also counts as a state-machine pass
        assertThat(reportRow("R_SM").outcome()).isEqualTo("PASS");
        verify(faultRepository, never()).save(any());
    }

    @Test
    @DisplayName("response rule violates when the deadline passes without the expected state")
    void responseRule_deadlineExpires_violates() {
        feedBaseline();
        feed(T0 + 1.0, sig("Btn", 2, "Pressed"));
        feed(T0 + 2.0, sig("Btn", 1, "Idle"));                // 1000ms later, never secured

        IntegrityFaultEntity saved = onlySavedFinding();
        assertThat(saved.getFaultType()).isEqualTo("REQUIREMENT_VIOLATED");
        assertThat(saved.getLayer()).isEqualTo("REQUIREMENT");
        assertThat(saved.getRequirementId()).isEqualTo("R_RESP");
        assertThat(saved.getMsgName()).isEqualTo("R_RESP");
        assertThat(saved.getSeverity()).isEqualTo("HIGH");
        assertThat(saved.getDescription()).isEqualTo("Car did not secure after lock press");
        assertThat(saved.getEvidenceJson()).contains("\"deadlineMs\":660");
        assertThat(saved.getCheckListJson()).contains("Key fob battery");
        assertThat(reportRow("R_RESP").outcome()).isEqualTo("VIOLATED");
    }

    @Test
    @DisplayName("late expected state reports TIMING_VIOLATED with the measured latency")
    void responseRule_lateResponse_timingViolatedWithLatency() {
        feedBaseline();
        feed(T0 + 1.0, sig("Btn", 2, "Pressed"));
        feed(T0 + 2.0, sig("Led_Status", 3, "red"));          // secured after 1000ms (> 660ms)

        IntegrityFaultEntity saved = onlySavedFinding();
        assertThat(saved.getFaultType()).isEqualTo("REQUIREMENT_TIMING_VIOLATED");
        assertThat(saved.getRequirementId()).isEqualTo("R_RESP");
        assertThat(saved.getEvidenceJson())
                .contains("\"latencyMs\":1000")
                .contains("\"deadlineMs\":660");
        assertThat(reportRow("R_RESP").outcome()).isEqualTo("TIMING_VIOLATED");
        assertThat(reportRow("R_RESP").timingViolatedCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("absence rule violates when the forbidden change happens under the guard")
    void absenceRule_forbiddenChangeWhileGuardHeld_violates() {
        feed(T0, sig("KEY_Pos", 0, "Unknown") + "," + sig("Led_Status", 1, "green"));
        feed(T0 + 1.0, sig("Led_Status", 3, "red"));          // car_state changes while Unknown

        ArgumentCaptor<IntegrityFaultEntity> captor =
                ArgumentCaptor.forClass(IntegrityFaultEntity.class);
        verify(faultRepository).save(captor.capture());
        IntegrityFaultEntity saved = captor.getValue();
        assertThat(saved.getRequirementId()).isEqualTo("R_ABS");
        assertThat(saved.getFaultType()).isEqualTo("REQUIREMENT_VIOLATED");
        assertThat(saved.getSeverity()).isEqualTo("CRITICAL");
        assertThat(saved.getEvidenceJson()).contains("\"from\":\"unlocked\"")
                .contains("\"to\":\"secured\"");
        assertThat(reportRow("R_ABS").outcome()).isEqualTo("VIOLATED");
    }

    @Test
    @DisplayName("state transition not on the allowed list raises ILLEGAL_TRANSITION")
    void stateMachine_unlistedTransition_illegalTransition() {
        feed(T0, sig("KEY_Pos", 1, "Outside") + "," + sig("Led_Status", 3, "red"));
        feed(T0 + 1.0, sig("Led_Status", 1, "green"));        // secured -> unlocked: not allowed

        IntegrityFaultEntity saved = onlySavedFinding();
        assertThat(saved.getFaultType()).isEqualTo("ILLEGAL_TRANSITION");
        assertThat(saved.getRequirementId()).isEqualTo("R_SM");
        assertThat(saved.getEvidenceJson()).contains("\"from\":\"secured\"")
                .contains("\"to\":\"unlocked\"");
        assertThat(reportRow("R_SM").outcome()).isEqualTo("VIOLATED");
    }

    @Test
    @DisplayName("draft rules are tracked for coverage but never persist findings")
    void draftRule_violation_isCountedButNeverRaised() {
        feedBaseline();
        feed(T0 + 1.0, sig("Btn", 2, "Pressed"));             // arms R_RESP (660ms) + R_DRAFT (100ms)
        feed(T0 + 1.2, sig("Btn", 1, "Idle"));                // 200ms: R_DRAFT deadline passed

        verify(faultRepository, never()).save(any());
        RuleReportDto draft = reportRow("R_DRAFT");
        assertThat(draft.outcome()).isEqualTo("NOT_TESTED");  // drafts never get a verdict
        assertThat(draft.violatedCount()).isEqualTo(1);       // ...but coverage is tracked
        assertThat(reportRow("R_RESP").outcome()).isEqualTo("NOT_TESTED"); // still pending
    }

    @Test
    @DisplayName("report summarizes per-rule outcomes for a live session")
    void report_liveSession_summarizesOutcomes() {
        feedBaseline();
        feed(T0 + 1.0, sig("Btn", 2, "Pressed"));
        feed(T0 + 1.3, sig("Led_Status", 3, "red"));

        RequirementReportDto report = service.report(SESSION);
        assertThat(report.live()).isTrue();
        assertThat(report.totalRules()).isEqualTo(4);
        assertThat(report.passed()).isEqualTo(2);             // R_RESP + R_SM
        assertThat(report.violated()).isZero();
        assertThat(report.notTested()).isEqualTo(2);          // R_ABS + R_DRAFT
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Establishes KEY_Pos=Outside, Btn=Idle, Led=green (car_state=unlocked). */
    private void feedBaseline() {
        feed(T0, sig("KEY_Pos", 1, "Outside") + ","
                + sig("Btn", 1, "Idle") + ","
                + sig("Led_Status", 1, "green"));
    }

    private void feed(double ts, String signalsJsonBody) {
        CanFrameEntity frame = CanFrameEntity.builder()
                .sessionId(SESSION)
                .msgId("0x100")
                .msgName("TEST_MSG")
                .timestamp(ts)
                .build();
        service.onFrame(frame, "[" + signalsJsonBody + "]", 0.0);
    }

    private static String sig(String name, int raw, String label) {
        return String.format(
                "{\"signal_name\":\"%s\",\"raw_value\":%d,\"label\":\"%s\"}", name, raw, label);
    }

    private IntegrityFaultEntity onlySavedFinding() {
        ArgumentCaptor<IntegrityFaultEntity> captor =
                ArgumentCaptor.forClass(IntegrityFaultEntity.class);
        verify(faultRepository).save(captor.capture());
        return captor.getValue();
    }

    private RuleReportDto reportRow(String ruleId) {
        return service.report(SESSION).rules().stream()
                .filter(r -> r.ruleId().equals(ruleId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("rule missing from report: " + ruleId));
    }
}
