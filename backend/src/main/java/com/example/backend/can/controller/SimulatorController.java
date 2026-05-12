package com.example.backend.can.controller;

import com.example.backend.audit.AuditLog;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.time.LocalDateTime;

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

    /**
     * Allowed base directory for replay log files.
     * logFile from the request body is resolved relative to this directory.
     * Any path that escapes this directory (e.g. ../../etc/passwd) is rejected.
     */
    @Value("${simulator.logs.dir:${pipeline.uploads.dir}}")
    private String allowedLogsDir;

    /** Holds runtime metadata for a running simulator process. */
    private record SimulatorEntry(
            Process process,
            LocalDateTime startedAt,
            String mode
    ) {}

    private static final Map<String, SimulatorEntry> runningSimulators = new ConcurrentHashMap<>();

    /**
     * Remove entries from runningSimulators where the process has already exited.
     * Called at the start of every startSimulator() invocation to prevent
     * unbounded memory growth from accumulated dead process references.
     */
    private void cleanupDeadProcesses() {
        runningSimulators.entrySet().removeIf(entry -> !entry.getValue().process().isAlive());
    }

    /**
     * Validate that the requested log file path does not escape allowedLogsDir.
     * Resolves logFile relative to allowedLogsDir and normalizes the result.
     * If the normalized path does not start with allowedLogsDir, the request
     * is rejected with 400 Bad Request — path traversal attempt blocked.
     *
     * @param logFile filename or relative path from the request body
     * @return the validated absolute Path safe to pass to ProcessBuilder
     * @throws ResponseStatusException 400 if path escapes the allowed directory
     */
    private Path validateLogFilePath(String logFile) {
        Path base = Paths.get(allowedLogsDir).toAbsolutePath().normalize();
        Path resolved = base.resolve(logFile).normalize();
        if (!resolved.startsWith(base)) {
            log.warn("Path traversal attempt blocked: logFile='{}' resolved='{}'",
                    logFile, resolved);
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Invalid log file path"
            );
        }
        return resolved;
    }

    @AuditLog(action = "SIMULATION_START", resource = "simulator")
    @PostMapping("/start")
    public ResponseEntity<Map<String, String>> start(@RequestBody Map<String, Object> config) {
        // Remove dead process entries before adding a new one
        cleanupDeadProcesses();

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
                // Validate path before passing to ProcessBuilder
                Path safeLogPath = validateLogFilePath(logFile);
                cmd.add("--log");
                cmd.add(safeLogPath.toString());
            }

            if (loop)                cmd.add("--loop");
            if (injectValueErrors)   cmd.add("--inject-value-errors");
            if (injectTimingGaps)    cmd.add("--inject-timing-gaps");
            if (injectCounterErrors) cmd.add("--inject-counter-errors");

            String carUid = config.get("carUid") instanceof String s ? s : null;
            if (carUid != null && !carUid.isBlank()) {
                cmd.add("--car-uid");
                cmd.add(carUid);
            }

            String simId = UUID.randomUUID().toString();
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            Process process = pb.start();
            String modeStr = String.valueOf(config.getOrDefault("mode", "random"));
            runningSimulators.put(simId, new SimulatorEntry(process, LocalDateTime.now(), modeStr));

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

        } catch (ResponseStatusException rse) {
            // Re-throw validation exceptions as-is (400)
            throw rse;
        } catch (Exception e) {
            log.error("Failed to start simulator", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Unknown error"));
        }
    }

    @AuditLog(action = "SIMULATION_STOP", resource = "simulator", resourceIdParam = "simId")
    @PostMapping("/stop/{simId}")
    public ResponseEntity<Map<String, String>> stop(@PathVariable String simId) {
        SimulatorEntry entry = runningSimulators.remove(simId);
        if (entry == null) {
            return ResponseEntity.notFound().build();
        }
        entry.process().destroyForcibly();
        log.info("Simulator stopped: id={}", simId);
        return ResponseEntity.ok(Map.of("simId", simId, "status", "stopped"));
    }

    @AuditLog(action = "SIMULATION_STOP_ALL", resource = "simulator")
    @PostMapping("/stop-all")
    public ResponseEntity<Map<String, Object>> stopAll() {
        int count = runningSimulators.size();
        runningSimulators.forEach((id, entry) -> entry.process().destroyForcibly());
        runningSimulators.clear();
        return ResponseEntity.ok(Map.of("stopped", count));
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        cleanupDeadProcesses();

        List<Map<String, Object>> simulatorList = new ArrayList<>();
        runningSimulators.forEach((simId, entry) -> {
            Map<String, Object> info = new HashMap<>();
            info.put("simId", simId);
            info.put("running", entry.process().isAlive());
            // pid() available on Java 9+ — returns OptionalLong
            info.put("pid", entry.process().pid());
            info.put("startedAt", entry.startedAt().toString());
            info.put("mode", entry.mode());
            // framesProduced not available via Java IPC — tracked by Python stdout
            info.put("framesProduced", null);
            simulatorList.add(info);
        });

        // Also return first running simulator as flat fields for frontend convenience
        Map<String, Object> response = new HashMap<>();
        response.put("simulators", simulatorList);
        response.put("count", simulatorList.size());

        if (!simulatorList.isEmpty()) {
            Map<String, Object> first = simulatorList.get(0);
            response.put("running", first.get("running"));
            response.put("pid", first.get("pid"));
            response.put("startedAt", first.get("startedAt"));
            response.put("mode", first.get("mode"));
            response.put("simId", first.get("simId"));
        } else {
            response.put("running", false);
            response.put("pid", null);
            response.put("startedAt", null);
            response.put("mode", null);
            response.put("simId", null);
        }

        return ResponseEntity.ok(response);
    }
}
