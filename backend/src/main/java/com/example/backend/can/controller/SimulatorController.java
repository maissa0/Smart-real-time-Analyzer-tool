package com.example.backend.can.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/simulator")
@Slf4j
public class SimulatorController {

    @Value("${pipeline.python.executable}")
    private String pythonExecutable;

    @Value("${pipeline.python.script:}")
    private String pipelineScript;

    @Value("${pipeline.uploads.dir}")
    private String uploadsDir;

    private static final Map<String, Process> runningSimulators = new ConcurrentHashMap<>();

    @PostMapping("/start")
    public ResponseEntity<Map<String, String>> start(@RequestBody Map<String, Object> config) {
        try {
            String simulatorScript = pipelineScript.replace("pipeline.py", "can_simulator.py");

            String mode = config.get("mode") != null ? String.valueOf(config.get("mode")) : "random";
            String logFile = config.get("logFile") != null ? String.valueOf(config.get("logFile")) : "";
            double speed = config.get("speed") instanceof Number n ? n.doubleValue() : 1.0;
            boolean loop = Boolean.TRUE.equals(config.get("loop"));
            boolean injectValueErrors = Boolean.TRUE.equals(config.get("injectValueErrors"));
            boolean injectTimingGaps = Boolean.TRUE.equals(config.get("injectTimingGaps"));
            boolean injectCounterErrors = Boolean.TRUE.equals(config.get("injectCounterErrors"));
            double faultRate = config.get("faultRate") instanceof Number n2 ? n2.doubleValue() : 0.05;

            List<String> cmd = new ArrayList<>();
            cmd.add(pythonExecutable);
            cmd.add(simulatorScript);
            cmd.add("--mode");
            cmd.add(mode);
            cmd.add("--speed");
            cmd.add(String.valueOf(speed));
            cmd.add("--fault-rate");
            cmd.add(String.valueOf(faultRate));

            if ("replay".equals(mode) && !logFile.isEmpty()) {
                cmd.add("--log");
                cmd.add(logFile);
            }
            if (loop) {
                cmd.add("--loop");
            }
            if (injectValueErrors) {
                cmd.add("--inject-value-errors");
            }
            if (injectTimingGaps) {
                cmd.add("--inject-timing-gaps");
            }
            if (injectCounterErrors) {
                cmd.add("--inject-counter-errors");
            }

            String simId = UUID.randomUUID().toString();
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            Process process = pb.start();
            runningSimulators.put(simId, process);

            String shortId = simId.substring(0, Math.min(8, simId.length()));
            Thread logThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(process.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        log.info("[simulator:{}] {}", shortId, line);
                    }
                } catch (Exception e) {
                    log.error("Simulator output reader error", e);
                }
            }, "simulator-log-" + shortId);
            logThread.setDaemon(true);
            logThread.start();

            log.info("Simulator started: id={} mode={} speed={}x", simId, mode, speed);
            return ResponseEntity.ok(Map.of("simId", simId, "status", "started", "mode", mode));

        } catch (Exception e) {
            log.error("Failed to start simulator", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Unknown error"));
        }
    }

    @PostMapping("/stop/{simId}")
    public ResponseEntity<Map<String, String>> stop(@PathVariable String simId) {
        Process process = runningSimulators.remove(simId);
        if (process == null) {
            return ResponseEntity.notFound().build();
        }
        process.destroyForcibly();
        log.info("Simulator stopped: id={}", simId);
        return ResponseEntity.ok(Map.of("simId", simId, "status", "stopped"));
    }

    @PostMapping("/stop-all")
    public ResponseEntity<Map<String, Object>> stopAll() {
        int count = runningSimulators.size();
        runningSimulators.forEach((id, p) -> p.destroyForcibly());
        runningSimulators.clear();
        return ResponseEntity.ok(Map.of("stopped", count));
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        Map<String, String> statuses = new HashMap<>();
        runningSimulators.forEach((id, p) ->
                statuses.put(id, p.isAlive() ? "running" : "finished"));
        return ResponseEntity.ok(Map.of("simulators", statuses, "count", statuses.size()));
    }
}
