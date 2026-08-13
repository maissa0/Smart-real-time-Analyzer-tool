package com.example.backend.can.controller;

import com.example.backend.audit.AuditLog;
import com.example.backend.can.dto.SimulatorStartRequest;
import com.example.backend.can.dto.SimulatorStartResult;
import com.example.backend.can.dto.SimulatorStatusResult;
import com.example.backend.can.dto.StopAllResult;
import com.example.backend.can.service.SimulatorService;
import com.example.backend.exception.SafeErrorMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestController
@RequestMapping("/api/simulator")
@RequiredArgsConstructor
@Slf4j
public class SimulatorController {

    private final SimulatorService simulatorService;

    @PreAuthorize("hasAuthority('simulation:start') or hasRole('ADMIN')")
    @AuditLog(action = "SIMULATION_START", resource = "simulator")
    @PostMapping("/start")
    public ResponseEntity<?> start(@RequestBody SimulatorStartRequest config) {
        try {
            return ResponseEntity.ok(simulatorService.startSimulator(config));
        } catch (ResponseStatusException rse) {
            throw rse;
        } catch (Exception e) {
            log.error("Failed to start simulator: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to start simulator")));
        }
    }

    @PreAuthorize("hasAuthority('simulation:stop') or hasRole('ADMIN')")
    @AuditLog(action = "SIMULATION_STOP", resource = "simulator", resourceIdParam = "simId")
    @PostMapping("/stop/{simId}")
    public ResponseEntity<Map<String, String>> stop(@PathVariable String simId) {
        return simulatorService.stopSimulator(simId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PreAuthorize("hasAuthority('simulation:stop') or hasRole('ADMIN')")
    @AuditLog(action = "SIMULATION_STOP_ALL", resource = "simulator")
    @PostMapping("/stop-all")
    public ResponseEntity<StopAllResult> stopAll() {
        return ResponseEntity.ok(new StopAllResult(simulatorService.stopAll()));
    }

    @PreAuthorize("hasAuthority('simulation:start') or hasAuthority('simulation:stop') or hasRole('ADMIN')")
    @GetMapping("/status")
    public ResponseEntity<SimulatorStatusResult> status() {
        return ResponseEntity.ok(simulatorService.getStatus());
    }
}
