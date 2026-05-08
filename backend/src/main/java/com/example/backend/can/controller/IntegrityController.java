package com.example.backend.can.controller;

import com.example.backend.can.entity.IntegrityFaultEntity;
import com.example.backend.can.repository.IntegrityFaultRepository;
import com.example.backend.can.service.CatalogLoaderService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/can/integrity")
@RequiredArgsConstructor
public class IntegrityController {

    private final IntegrityFaultRepository faultRepository;
    private final CatalogLoaderService catalogLoaderService;

    @GetMapping("/sessions/{sessionId}/faults")
    public ResponseEntity<List<IntegrityFaultEntity>> getFaults(@PathVariable String sessionId) {
        return ResponseEntity.ok(
                faultRepository.findBySessionIdOrderByFrameTimestampAsc(sessionId));
    }

    @GetMapping("/sessions/{sessionId}/summary")
    public ResponseEntity<Map<String, Object>> getSummary(@PathVariable String sessionId) {
        return ResponseEntity.ok(Map.of(
                "totalFaults", faultRepository.countBySessionId(sessionId),
                "duplicates", faultRepository.countBySessionIdAndFaultType(sessionId, "DUPLICATE"),
                "timingGaps", faultRepository.countBySessionIdAndFaultType(sessionId, "TIMING_GAP"),
                "signalRangeViolations", faultRepository.countBySessionIdAndFaultType(sessionId, "SIGNAL_RANGE"),
                "affectedMsgIds", faultRepository.findDistinctMsgIdsBySessionId(sessionId),
                "healthy", faultRepository.countBySessionId(sessionId) == 0
        ));
    }

    @GetMapping("/catalog")
    public ResponseEntity<Map<String, Object>> getCatalog() {
        return ResponseEntity.ok(Map.of(
                "signalValidValues", catalogLoaderService.getSignalValidValues(),
                "messageCycleTimes", catalogLoaderService.getMessageCycleTimes()
        ));
    }
}
