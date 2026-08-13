package com.example.backend.can.service;

import com.example.backend.can.entity.DiagnosticRuleEntity;
import com.example.backend.can.entity.SubsystemMappingEntity;
import com.example.backend.can.repository.DiagnosticRuleRepository;
import com.example.backend.can.repository.SubsystemMappingRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/**
 * Owns the user-refinable diagnostic knowledge base: seeds it from the catalogues,
 * resolves faults to the best rule via layered fallback, and exposes CRUD for the
 * admin "Diagnostics Catalog" page and inline editing.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DiagnosticKbService {

    private final DiagnosticRuleRepository ruleRepository;
    private final SubsystemMappingRepository subsystemRepository;
    private final CatalogLoaderService catalogLoaderService;

    private static final String DEFAULT_SUBSYSTEM = "General";
    private static final List<String> FAULT_TYPES =
            List.of("SIGNAL_RANGE", "COUNTER_ERROR", "TIMING_GAP", "DUPLICATE");

    /** KB scope for rules keyed by a requirement id (Phase 5). */
    public static final String SCOPE_REQUIREMENT = "REQUIREMENT";

    // ── Seeding (idempotent: only seeds when the tables are empty) ──────────────

    @PostConstruct
    public void seedIfEmpty() {
        try {
            seedSubsystemMappings();
            seedDefaultRules();
        } catch (Exception e) {
            log.error("Diagnostic KB seeding failed: {}", e.getMessage());
        }
    }

    private void seedSubsystemMappings() {
        if (subsystemRepository.count() > 0) return;
        Map<String, String> msgToBus = catalogLoaderService.getMessageSubsystems();
        List<SubsystemMappingEntity> rows = new ArrayList<>();
        for (var entry : msgToBus.entrySet()) {
            rows.add(SubsystemMappingEntity.builder()
                    .msgName(entry.getKey())
                    .subsystem(subsystemLabel(entry.getValue()))
                    .build());
        }
        if (!rows.isEmpty()) {
            subsystemRepository.saveAll(rows);
            log.info("Seeded {} subsystem mappings from catalogues", rows.size());
        }
    }

    private void seedDefaultRules() {
        if (ruleRepository.count() > 0) return;
        List<DiagnosticRuleEntity> rules = new ArrayList<>();

        // Ultimate fallback per fault type.
        for (String ft : FAULT_TYPES) {
            rules.add(defaultRule("DEFAULT", "*", ft, DEFAULT_SUBSYSTEM));
        }
        // Per-subsystem starter rules so every fault gets a subsystem-aware default.
        Set<String> subsystems = new TreeSet<>();
        for (SubsystemMappingEntity m : subsystemRepository.findAll()) subsystems.add(m.getSubsystem());
        for (String sub : subsystems) {
            for (String ft : FAULT_TYPES) {
                rules.add(defaultRule("SUBSYSTEM", sub, ft, sub));
            }
        }
        ruleRepository.saveAll(rules);
        log.info("Seeded {} default diagnostic rules", rules.size());
    }

    private DiagnosticRuleEntity defaultRule(String scope, String matchKey, String faultType, String subsystem) {
        return DiagnosticRuleEntity.builder()
                .scope(scope).matchKey(matchKey).faultType(faultType).subsystem(subsystem)
                .title(defaultTitle(faultType, subsystem))
                .meaning(defaultMeaning(faultType, subsystem))
                .likelyCause(defaultCause(faultType))
                .whatToCheck(defaultCheck(faultType, subsystem))
                .severityWeight(defaultSeverity(faultType))
                .enabled(true).builtin(true).updatedBy("system")
                .build();
    }

    // ── Layered lookup ─────────────────────────────────────────────────────────

    /**
     * Phase-5 aware lookup: a REQUIREMENT-scope rule keyed by the requirement id
     * wins over everything, so per-requirement guidance (seeded from the rule's
     * check-list, then user-refined) is what the findings card surfaces. Falls
     * back to the standard SIGNAL -> MESSAGE -> SUBSYSTEM -> DEFAULT chain.
     */
    public Optional<DiagnosticRuleEntity> resolve(String faultType, String msgName,
                                                  String signalName, String requirementId) {
        if (requirementId != null && !requirementId.isBlank()) {
            List<DiagnosticRuleEntity> found =
                    ruleRepository.findByScopeAndMatchKeyAndEnabledTrue(SCOPE_REQUIREMENT, requirementId);
            Optional<DiagnosticRuleEntity> exact = found.stream()
                    .filter(r -> faultType != null && faultType.equals(r.getFaultType())).findFirst();
            if (exact.isPresent()) {
                return exact;
            }
            Optional<DiagnosticRuleEntity> any = found.stream()
                    .filter(r -> r.getFaultType() == null).findFirst();
            if (any.isPresent()) {
                return any;
            }
        }
        return resolve(faultType, msgName, signalName);
    }

    /**
     * Resolves the best diagnostic rule for a fault via layered fallback:
     * SIGNAL(signalName) -> MESSAGE(msgName) -> SUBSYSTEM(subsystem) -> DEFAULT("*").
     * At each level an exact faultType match wins over a null-faultType ("any") rule.
     */
    public Optional<DiagnosticRuleEntity> resolve(String faultType, String msgName, String signalName) {
        String subsystem = subsystemFor(msgName);
        List<Map.Entry<String, String>> layers = new ArrayList<>();
        if (signalName != null && !signalName.isBlank()) layers.add(Map.entry("SIGNAL", signalName));
        if (msgName != null && !msgName.isBlank())       layers.add(Map.entry("MESSAGE", msgName));
        layers.add(Map.entry("SUBSYSTEM", subsystem));
        layers.add(Map.entry("DEFAULT", "*"));

        for (var layer : layers) {
            List<DiagnosticRuleEntity> found =
                    ruleRepository.findByScopeAndMatchKeyAndEnabledTrue(layer.getKey(), layer.getValue());
            if (found.isEmpty()) continue;
            Optional<DiagnosticRuleEntity> exact = found.stream()
                    .filter(r -> faultType != null && faultType.equals(r.getFaultType())).findFirst();
            if (exact.isPresent()) return exact;
            Optional<DiagnosticRuleEntity> any = found.stream()
                    .filter(r -> r.getFaultType() == null).findFirst();
            if (any.isPresent()) return any;
        }
        return Optional.empty();
    }

    public String subsystemFor(String msgName) {
        if (msgName == null) return DEFAULT_SUBSYSTEM;
        return subsystemRepository.findByMsgName(msgName)
                .map(SubsystemMappingEntity::getSubsystem)
                .orElse(DEFAULT_SUBSYSTEM);
    }

    /**
     * Subsystem for the first signal a loaded catalog owns — how REQUIREMENT
     * findings (which carry a rule id, not a message name) find their ECU
     * grouping for Phase-5 root-cause clustering.
     */
    public String subsystemForSignals(List<String> signalNames) {
        if (signalNames == null) {
            return DEFAULT_SUBSYSTEM;
        }
        for (String signal : signalNames) {
            if (signal == null || signal.isBlank()) {
                continue;
            }
            for (var entry : catalogLoaderService.getMessageSignalValidValues().entrySet()) {
                if (entry.getValue().containsKey(signal)) {
                    return subsystemFor(entry.getKey());
                }
            }
        }
        return DEFAULT_SUBSYSTEM;
    }

    /**
     * Seed one REQUIREMENT-scope KB rule from a violated requirement (Phase 5:
     * the rule's check-list is the seed, the KB is where users enrich it).
     * Idempotent — an existing rule for the requirement id is never touched,
     * so user refinements survive.
     */
    public void ensureRequirementRule(String requirementId, String title, String severityName,
                                      List<String> checkList, String subsystem) {
        if (requirementId == null || requirementId.isBlank()) {
            return;
        }
        try {
            if (!ruleRepository.findByScopeAndMatchKey(SCOPE_REQUIREMENT, requirementId).isEmpty()) {
                return;
            }
            List<String> checks = checkList != null ? checkList : List.of();
            ruleRepository.save(DiagnosticRuleEntity.builder()
                    .scope(SCOPE_REQUIREMENT)
                    .matchKey(requirementId)
                    .faultType(null) // applies to every violation type of this requirement
                    .subsystem(subsystem != null ? subsystem : DEFAULT_SUBSYSTEM)
                    .title(requirementId + " — " + (title != null ? title : "Requirement violated"))
                    .meaning("The behavioral requirement " + requirementId
                            + (title != null ? " (\"" + title + "\")" : "")
                            + " was violated: the vehicle did not respond the way the requirement specifies.")
                    .likelyCause(checks.isEmpty()
                            ? "See the requirement's diagnostic check-list."
                            : "Most likely (in order): " + String.join("; ", checks))
                    .whatToCheck(checks.isEmpty()
                            ? "Review the involved signals around the violation timestamp."
                            : String.join("\n", checks))
                    .severityWeight(severityWeightFor(severityName))
                    .enabled(true).builtin(true).updatedBy("system")
                    .build());
            log.info("Seeded REQUIREMENT KB rule for {}", requirementId);
        } catch (Exception e) {
            log.warn("Could not seed REQUIREMENT KB rule for {}: {}", requirementId, e.getMessage());
        }
    }

    /** Requirement severity name (CRITICAL..INFO) -> KB severity weight. */
    private static int severityWeightFor(String severityName) {
        if (severityName == null) return 3;
        return switch (severityName.toUpperCase()) {
            case "CRITICAL" -> 5;
            case "HIGH" -> 4;
            case "MEDIUM" -> 3;
            case "LOW" -> 2;
            default -> 1; // INFO
        };
    }

    // ── CRUD (read/create/update — consumed by the inline fault editor) ───────

    public Optional<DiagnosticRuleEntity> getRule(Long id) {
        return ruleRepository.findById(id);
    }

    public DiagnosticRuleEntity createRule(DiagnosticRuleEntity rule, String user) {
        rule.setId(null);
        rule.setBuiltin(false);
        rule.setUpdatedBy(user);
        if (rule.getScope() == null || rule.getScope().isBlank()) rule.setScope("SIGNAL");
        if (rule.getMatchKey() == null || rule.getMatchKey().isBlank())
            throw new IllegalArgumentException("matchKey is required");
        return ruleRepository.save(rule);
    }

    public DiagnosticRuleEntity updateRule(Long id, DiagnosticRuleEntity patch, String user) {
        DiagnosticRuleEntity r = ruleRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Rule not found: " + id));
        r.setScope(patch.getScope());
        r.setMatchKey(patch.getMatchKey());
        r.setFaultType(patch.getFaultType());
        r.setSubsystem(patch.getSubsystem());
        r.setTitle(patch.getTitle());
        r.setMeaning(patch.getMeaning());
        r.setLikelyCause(patch.getLikelyCause());
        r.setWhatToCheck(patch.getWhatToCheck());
        r.setSeverityWeight(patch.getSeverityWeight());
        r.setDisplayName(patch.getDisplayName());
        r.setEnabled(patch.isEnabled());
        r.setUpdatedBy(user);
        return ruleRepository.save(r);
    }

    // ── Label + template helpers ───────────────────────────────────────────────

    private static String subsystemLabel(String busName) {
        if (busName == null) return DEFAULT_SUBSYSTEM;
        return switch (busName.toUpperCase()) {
            case "ADAS_CAN" -> "ADAS & Safety";
            case "CHASSIS_CAN" -> "Chassis & Braking";
            case "CLUSTER_CAN" -> "Instrument Cluster";
            case "KEY_CAN" -> "Access & Key";
            case "POWERTRAIN_CAN" -> "Powertrain";
            case "CAR_CAN" -> "Body & Comfort";
            default -> {
                String s = busName.replace("_CAN", "").replace('_', ' ').trim();
                yield s.isEmpty() ? DEFAULT_SUBSYSTEM : s;
            }
        };
    }

    private static int defaultSeverity(String faultType) {
        return switch (faultType) {
            case "SIGNAL_RANGE" -> 4;
            case "COUNTER_ERROR", "TIMING_GAP" -> 2;
            default -> 1; // DUPLICATE
        };
    }

    private static String defaultTitle(String faultType, String sub) {
        return switch (faultType) {
            case "SIGNAL_RANGE" -> sub + " — Out-of-range signal value";
            case "COUNTER_ERROR" -> sub + " — Lost message sequence";
            case "TIMING_GAP" -> sub + " — Late / missed message";
            default -> sub + " — Duplicate frames";
        };
    }

    private static String defaultMeaning(String faultType, String sub) {
        return switch (faultType) {
            case "SIGNAL_RANGE" -> "A signal in the " + sub + " subsystem reported a value outside its defined valid range, so the ECU is publishing data the catalogue does not consider legal.";
            case "COUNTER_ERROR" -> "The " + sub + " ECU skipped message sequence counters — one or more frames were lost on the bus or the ECU restarted mid-stream.";
            case "TIMING_GAP" -> "A " + sub + " message arrived later than its defined cycle time allows, so the subsystem briefly stopped reporting on schedule.";
            default -> "Identical " + sub + " frames were transmitted back-to-back with no change, which normally should not happen for a live signal.";
        };
    }

    private static String defaultCause(String faultType) {
        return switch (faultType) {
            case "SIGNAL_RANGE" -> "A failing sensor, a wiring/connector fault, or an ECU producing corrupt data.";
            case "COUNTER_ERROR" -> "Bus overload, intermittent wiring/grounds, or an ECU brown-out / reset.";
            case "TIMING_GAP" -> "Bus congestion, a slow or resetting ECU, or a node dropping off the bus.";
            default -> "ECU retransmission, a stuck node, or a bus echo/reflection.";
        };
    }

    private static String defaultCheck(String faultType, String sub) {
        return switch (faultType) {
            case "SIGNAL_RANGE" -> "Inspect the " + sub + " sensor(s) and their connectors, read stored DTCs, and verify calibration and supply voltage.";
            case "COUNTER_ERROR" -> "Check " + sub + " CAN wiring and grounds, look for ECU reset/undervoltage DTCs, and measure bus load.";
            case "TIMING_GAP" -> "Confirm the " + sub + " ECU is powered and transmitting, and check bus load and termination resistance.";
            default -> "Check for a misbehaving " + sub + " ECU or bus echo, and review the ECU firmware/config.";
        };
    }
}
