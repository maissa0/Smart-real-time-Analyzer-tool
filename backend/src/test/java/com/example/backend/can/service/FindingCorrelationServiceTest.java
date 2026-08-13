package com.example.backend.can.service;

import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Phase-5 fusion behaviour: subsystem/time clustering and the ML↔REQUIREMENT
 * merge in both arrival orders. Pure JUnit + Mockito, no Spring context.
 */
class FindingCorrelationServiceTest {

    private static final String SESSION = "sess-1";
    private static final double T0 = 1_700_000_000.0;

    private IntegrityFaultRepository faultRepository;
    private DiagnosticKbService kbService;
    private FindingCorrelationService service;

    private final AtomicLong idSequence = new AtomicLong(100);

    @BeforeEach
    void setUp() {
        faultRepository = mock(IntegrityFaultRepository.class);
        kbService = mock(DiagnosticKbService.class);
        service = new FindingCorrelationService(faultRepository, kbService, new ObjectMapper());

        when(kbService.subsystemFor("Door_Status")).thenReturn("Body & Comfort");
        when(kbService.subsystemFor("Key_Msg")).thenReturn("Body & Comfort");
        when(kbService.subsystemFor("Brake_Msg")).thenReturn("Chassis & Braking");
        when(kbService.subsystemForSignals(any())).thenReturn("Body & Comfort");
    }

    // ── Clustering ───────────────────────────────────────────────────────────

    @Test
    @DisplayName("findings of one subsystem within the window share a cluster")
    void sameSubsystemWithinWindow_shareCluster() {
        IntegrityFaultEntity a = spec("Door_Status", T0);
        IntegrityFaultEntity b = spec("Key_Msg", T0 + 1.5);

        service.onFindingPersisted(a, List.of());
        service.onFindingPersisted(b, List.of());

        assertThat(a.getClusterId()).isEqualTo("Body & Comfort#1");
        assertThat(b.getClusterId()).isEqualTo("Body & Comfort#1");
        verify(faultRepository).updateClusterId(a.getId(), "Body & Comfort#1");
        verify(faultRepository).updateClusterId(b.getId(), "Body & Comfort#1");
    }

    @Test
    @DisplayName("outside the window or another subsystem opens a new cluster")
    void outsideWindowOrOtherSubsystem_newCluster() {
        IntegrityFaultEntity a = spec("Door_Status", T0);
        IntegrityFaultEntity b = spec("Door_Status", T0 + 10.0);   // window expired
        IntegrityFaultEntity c = spec("Brake_Msg", T0 + 10.5);    // other subsystem

        service.onFindingPersisted(a, List.of());
        service.onFindingPersisted(b, List.of());
        service.onFindingPersisted(c, List.of());

        assertThat(a.getClusterId()).isEqualTo("Body & Comfort#1");
        assertThat(b.getClusterId()).isEqualTo("Body & Comfort#2");
        assertThat(c.getClusterId()).isEqualTo("Chassis & Braking#3");
    }

    // ── ML ↔ REQUIREMENT merge ───────────────────────────────────────────────

    @Test
    @DisplayName("ML finding inside a requirement window is boosted and linked (ML arrives second)")
    void mlAfterRequirement_boostedAndLinked() {
        IntegrityFaultEntity req = requirement("CA_1", T0 + 1.0);
        when(faultRepository.findById(req.getId())).thenReturn(Optional.of(req));
        service.onFindingPersisted(req, List.of("Door_Latch"));

        IntegrityFaultEntity ml = ml("Door_Status", T0 + 1.8);
        service.onFindingPersisted(ml, List.of());

        assertThat(ml.getSeverity()).isEqualTo("MEDIUM");
        assertThat(ml.getClusterId()).isEqualTo(req.getClusterId());

        ArgumentCaptor<String> mlJson = ArgumentCaptor.forClass(String.class);
        verify(faultRepository).applyMlCorrelation(
                eq(ml.getId()), eq(req.getClusterId()), eq("MEDIUM"), mlJson.capture());
        assertThat(mlJson.getValue())
                .contains("\"supportsFindingId\":" + req.getId())
                .contains("\"requirementId\":\"CA_1\"");

        ArgumentCaptor<String> reqJson = ArgumentCaptor.forClass(String.class);
        verify(faultRepository).updateCorrelationJson(eq(req.getId()), reqJson.capture());
        assertThat(reqJson.getValue()).contains("\"supportingMl\"")
                .contains("\"findingId\":" + ml.getId());
    }

    @Test
    @DisplayName("requirement finding adopts earlier ML findings in its window (REQ arrives second)")
    void requirementAfterMl_mergesEarlierMl() {
        IntegrityFaultEntity ml = ml("Door_Status", T0 + 0.5);
        service.onFindingPersisted(ml, List.of());

        IntegrityFaultEntity req = requirement("CA_2", T0 + 1.2);
        when(faultRepository.findById(req.getId())).thenReturn(Optional.of(req));
        service.onFindingPersisted(req, List.of("Door_Latch"));

        verify(faultRepository).applyMlCorrelation(
                eq(ml.getId()), eq(req.getClusterId()), eq("MEDIUM"), anyString());
        ArgumentCaptor<String> reqJson = ArgumentCaptor.forClass(String.class);
        verify(faultRepository).updateCorrelationJson(eq(req.getId()), reqJson.capture());
        assertThat(reqJson.getValue()).contains("\"findingId\":" + ml.getId());
    }

    @Test
    @DisplayName("ML finding with no requirement nearby stays advisory")
    void mlWithoutRequirement_notBoosted() {
        IntegrityFaultEntity ml = ml("Door_Status", T0);
        service.onFindingPersisted(ml, List.of());

        assertThat(ml.getSeverity()).isEqualTo("INFO");
        verify(faultRepository, never())
                .applyMlCorrelation(anyLong(), anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("cleared session forgets requirement windows")
    void clearSession_forgetsState() {
        IntegrityFaultEntity req = requirement("CA_1", T0 + 1.0);
        when(faultRepository.findById(req.getId())).thenReturn(Optional.of(req));
        service.onFindingPersisted(req, List.of());

        service.clearSession(SESSION);

        IntegrityFaultEntity ml = ml("Door_Status", T0 + 1.5);
        service.onFindingPersisted(ml, List.of());
        verify(faultRepository, never())
                .applyMlCorrelation(anyLong(), anyString(), anyString(), anyString());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private IntegrityFaultEntity spec(String msgName, double ts) {
        return IntegrityFaultEntity.builder()
                .id(idSequence.getAndIncrement())
                .sessionId(SESSION)
                .msgName(msgName)
                .faultType("TIMING_GAP")
                .frameTimestamp(ts)
                .layer("SPEC")
                .build();
    }

    private IntegrityFaultEntity requirement(String requirementId, double ts) {
        return IntegrityFaultEntity.builder()
                .id(idSequence.getAndIncrement())
                .sessionId(SESSION)
                .msgName(requirementId)
                .faultType("REQUIREMENT_VIOLATED")
                .frameTimestamp(ts)
                .layer("REQUIREMENT")
                .requirementId(requirementId)
                .severity("HIGH")
                .evidenceJson("{\"triggerTs\":" + (ts - 0.6) + ",\"deadlineMs\":600}")
                .build();
    }

    private IntegrityFaultEntity ml(String msgName, double ts) {
        return IntegrityFaultEntity.builder()
                .id(idSequence.getAndIncrement())
                .sessionId(SESSION)
                .msgName(msgName)
                .faultType("ML_TRANSITION")
                .frameTimestamp(ts)
                .layer("ML")
                .severity("INFO")
                .build();
    }
}
