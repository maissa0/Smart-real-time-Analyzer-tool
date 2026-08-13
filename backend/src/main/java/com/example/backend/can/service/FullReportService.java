package com.example.backend.can.service;

import com.example.backend.can.dto.DiagnosticReportDto;
import com.example.backend.can.dto.EnrichedFaultDto;
import com.example.backend.can.dto.FaultContextSignal;
import com.example.backend.can.dto.FindingClusterDto;
import com.example.backend.can.dto.FullReportDto;
import com.example.backend.can.dto.FullReportDto.SessionHealthPoint;
import com.example.backend.can.dto.RequirementDtos.RequirementReportDto;
import com.example.backend.can.dto.SessionSummaryDto;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.repository.CanSessionRepository;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.IntegrityFaultRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Composes the one authoritative session report out of the existing analysis
 * services — requirements engine, integrity/KB enrichment, Phase-5 clusters,
 * subsystem diagnostics and the AI summary. Pure composition: every verdict and
 * finding is produced elsewhere and only assembled here.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FullReportService {

    private static final String LAYER_REQUIREMENT = "REQUIREMENT";
    /** Worst fault types first — the grouped map keeps this order. */
    private static final List<String> FAULT_TYPE_ORDER = List.of(
            "SIGNAL_RANGE", "COUNTER_ERROR", "SEQUENCE_REGRESSION",
            "TIMING_GAP", "DUPLICATE", "MESSAGE_TIMEOUT");
    private static final Map<String, Integer> RULE_SEVERITY_ORDER = Map.of(
            "CRITICAL", 0, "HIGH", 1, "MEDIUM", 2, "LOW", 3, "INFO", 4);
    /** Prior sessions included in the health-trend history. */
    private static final int HISTORY_LIMIT = 10;

    private final IntegrityService integrityService;
    private final DiagnosticReportService diagnosticReportService;
    private final RequirementMonitorService requirementMonitorService;
    private final SessionSummaryService sessionSummaryService;
    private final CanSessionRepository canSessionRepository;
    private final CarRepository carRepository;
    private final IntegrityFaultRepository faultRepository;

    public FullReportDto buildReport(String sessionId) {
        List<EnrichedFaultDto> allFaults = integrityService.getFaults(sessionId);

        List<EnrichedFaultDto> specFaults = allFaults.stream()
                .filter(f -> !LAYER_REQUIREMENT.equals(f.layer()))
                .toList();
        List<EnrichedFaultDto> requirementFindings = allFaults.stream()
                .filter(f -> LAYER_REQUIREMENT.equals(f.layer()))
                .sorted(Comparator.comparingInt(f ->
                        RULE_SEVERITY_ORDER.getOrDefault(f.ruleSeverity(), 9)))
                .toList();

        RequirementReportDto requirements = requirementMonitorService.report(sessionId);
        long requirementViolations = requirements == null
                ? 0 : requirements.violated() + requirements.timingViolated();
        String verdict = (specFaults.isEmpty() && requirementViolations == 0) ? "PASS" : "FAIL";

        SessionSummaryDto summary = sessionSummaryService.findBySessionId(sessionId).orElse(null);
        List<FindingClusterDto> clusters = integrityService.getClusters(sessionId);
        DiagnosticReportDto diagnostics = diagnosticReportService.buildReport(sessionId);

        CanSessionEntity session = canSessionRepository.findBySessionId(sessionId).orElse(null);
        CarContext car = resolveCarContext(session);

        return new FullReportDto(
                sessionId,
                verdict,
                specFaults.size(),
                requirementViolations,
                summary,
                requirements,
                groupByType(specFaults),
                requirementFindings,
                clusters,
                diagnostics,
                pickVehicleState(diagnostics),
                car.vehicle(),
                car.faultRate(),
                car.history());
    }

    /** Groups SPEC/ML faults by type, worst types first, unknown types last. */
    private Map<String, List<EnrichedFaultDto>> groupByType(List<EnrichedFaultDto> faults) {
        Map<String, List<EnrichedFaultDto>> grouped = new LinkedHashMap<>();
        for (String type : FAULT_TYPE_ORDER) {
            grouped.put(type, new ArrayList<>());
        }
        for (EnrichedFaultDto f : faults) {
            grouped.computeIfAbsent(f.faultType(), k -> new ArrayList<>()).add(f);
        }
        grouped.values().removeIf(List::isEmpty);
        return grouped;
    }

    /**
     * Representative operating context: the first fault with a captured context
     * in the worst-first subsystem ordering (same pick the Twin export used).
     */
    private List<FaultContextSignal> pickVehicleState(DiagnosticReportDto diagnostics) {
        if (diagnostics == null) {
            return List.of();
        }
        return diagnostics.subsystems().stream()
                .flatMap(s -> s.faults().stream())
                .map(EnrichedFaultDto::context)
                .filter(c -> c != null && !c.isEmpty())
                .findFirst()
                .orElse(List.of());
    }

    private record CarContext(String vehicle, Double faultRate, List<SessionHealthPoint> history) {}

    /** Car display name, per-car fault rate and prior-session health points. */
    private CarContext resolveCarContext(CanSessionEntity session) {
        if (session == null || session.getCarId() == null) {
            return new CarContext(null, null, List.of());
        }
        Long carId = session.getCarId();
        String vehicle = carRepository.findById(carId)
                .map(c -> c.getMake() + " " + c.getModel() + " " + c.getYear())
                .orElse(null);

        List<CanSessionEntity> carSessions = canSessionRepository.findByCarIdOrderByCreatedAtDesc(carId);
        long totalFrames = carSessions.stream()
                .mapToLong(s -> s.getFrameCount() != null ? s.getFrameCount() : 0)
                .sum();
        Double faultRate = null;
        try {
            long totalFaults = faultRepository.countFaultsByCarId(carId);
            faultRate = totalFrames > 0 ? (totalFaults * 100.0) / totalFrames : null;
        } catch (Exception e) {
            log.warn("Could not compute fault rate for car {}: {}", carId, e.getMessage());
        }

        List<SessionHealthPoint> history = carSessions.stream()
                .filter(s -> !session.getSessionId().equals(s.getSessionId()))
                .limit(HISTORY_LIMIT)
                .map(s -> {
                    long faults = faultRepository.countBySessionId(s.getSessionId());
                    int frames = s.getFrameCount() != null ? s.getFrameCount() : 0;
                    return new SessionHealthPoint(
                            s.getSessionId(),
                            s.getCreatedAt() != null ? s.getCreatedAt().toString() : null,
                            SessionSummaryService.healthScore((int) faults, frames),
                            faults,
                            s.getFrameCount());
                })
                .toList();

        return new CarContext(vehicle, faultRate, history);
    }
}
