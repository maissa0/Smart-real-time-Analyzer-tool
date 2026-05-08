package com.example.backend.can.service;

import com.example.backend.can.entity.CanFrameEntity;
import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class IntegrityAnalyzerService {

    private final IntegrityFaultRepository faultRepository;
    private final CatalogLoaderService catalogLoaderService;
    private final ObjectMapper objectMapper;

    // Minimum gap in seconds below which identical frames are duplicates
    private static final double MIN_INTERVAL_SECONDS = 0.001;
    // Multiplier on cycle time to determine max allowed gap (3x cycle = late by 2 full cycles)
    private static final double GAP_MULTIPLIER = 3.0;

    // Per-session state keyed by sessionId|msgName
    private final ConcurrentHashMap<String, Double> lastTimestamp = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> lastRawBytes = new ConcurrentHashMap<>();

    /** Run all integrity checks on a frame and persist any faults. */
    public void analyze(CanFrameEntity frame) {
        List<IntegrityFaultEntity> faults = new ArrayList<>();
        String stateKey = frame.getSessionId() + "|" + frame.getMsgName();

        Double prevTs = lastTimestamp.get(stateKey);
        String prevBytes = lastRawBytes.get(stateKey);

        if (prevTs != null && prevBytes != null && frame.getRawBytes() != null) {
            double gap = frame.getTimestamp() - prevTs;

            // Check 1 — Duplicate detection
            if (gap < MIN_INTERVAL_SECONDS && prevBytes.equals(frame.getRawBytes())) {
                faults.add(buildFault(frame, "DUPLICATE",
                        String.format("Duplicate frame for %s within %.4fs", frame.getMsgId(), gap)));
            }

            // Check 2 — Timing gap (only for cyclic messages)
            Long cycleMs = catalogLoaderService.getMessageCycleTimes().get(frame.getMsgName());
            if (cycleMs != null) {
                double maxGapSeconds = (cycleMs * GAP_MULTIPLIER) / 1000.0;
                if (gap > maxGapSeconds) {
                    faults.add(buildFault(frame, "TIMING_GAP",
                            String.format("Gap of %.2fs for %s exceeds %.1fs (cycle=%dms × %.0f)",
                                    gap, frame.getMsgName(), maxGapSeconds, cycleMs, GAP_MULTIPLIER)));
                }
            }
        }

        // Check 3 — Signal range validation using catalog valid values
        String signalsJson = frame.getSignals();
        if (signalsJson != null && !signalsJson.isBlank()) {
            try {
                List<Map<String, Object>> signals = objectMapper.readValue(
                        signalsJson, new TypeReference<>() { });
                Map<String, Set<Integer>> validValues = catalogLoaderService.getSignalValidValues();

                for (Map<String, Object> signal : signals) {
                    String name = (String) signal.get("signal_name");
                    Object rawVal = signal.get("raw_value");
                    if (name == null || rawVal == null) {
                        continue;
                    }

                    Set<Integer> allowed = validValues.get(name);
                    if (allowed == null || allowed.isEmpty()) {
                        continue;
                    }

                    int value = ((Number) rawVal).intValue();
                    if (!allowed.contains(value)) {
                        faults.add(buildFault(frame, "SIGNAL_RANGE",
                                String.format("Signal %s value %d not in valid set %s",
                                        name, value, allowed)));
                    }
                }
            } catch (Exception e) {
                log.warn("Failed to parse signals for frame {}: {}", frame.getId(), e.getMessage());
            }
        }

        lastTimestamp.put(stateKey, frame.getTimestamp());
        lastRawBytes.put(stateKey, frame.getRawBytes() != null ? frame.getRawBytes() : "");

        if (!faults.isEmpty()) {
            faultRepository.saveAll(faults);
            log.info("Saved {} fault(s) for frame {} [{}]",
                    faults.size(), frame.getId(), frame.getMsgName());
        }
    }

    private IntegrityFaultEntity buildFault(CanFrameEntity frame, String type, String desc) {
        return IntegrityFaultEntity.builder()
                .sessionId(frame.getSessionId())
                .frameId(frame.getId())
                .msgId(frame.getMsgId())
                .msgName(frame.getMsgName())
                .faultType(type)
                .description(desc)
                .frameTimestamp(frame.getTimestamp())
                .build();
    }
}
