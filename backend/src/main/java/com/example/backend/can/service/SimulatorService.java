package com.example.backend.can.service;

import com.example.backend.can.dto.SimulatorEntryDto;
import com.example.backend.can.dto.SimulatorStartRequest;
import com.example.backend.can.dto.SimulatorStartResult;
import com.example.backend.can.dto.SimulatorStatusResult;
import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.repository.CanSessionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Service
@Slf4j
public class SimulatorService {

    private final String pythonExecutable;
    private final String pipelineScript;
    private final String allowedLogsDir;
    private final CanSessionRepository canSessionRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final InfluxWriteService influxWriteService;
    private final CarService carService;

    // @Value parameters require an explicit constructor — @RequiredArgsConstructor
    // cannot apply @Value annotations on Lombok-generated constructor parameters.
    public SimulatorService(
            @Value("${pipeline.python.executable:C:/tools/Kpit_c/python_parser/.venv/Scripts/python.exe}")
            String pythonExecutable,
            @Value("${pipeline.python.script:}")
            String pipelineScript,
            @Value("${simulator.logs.dir:${pipeline.uploads.dir}}")
            String allowedLogsDir,
            CanSessionRepository canSessionRepository,
            SimpMessagingTemplate messagingTemplate,
            InfluxWriteService influxWriteService,
            CarService carService) {
        this.pythonExecutable     = pythonExecutable;
        this.pipelineScript       = pipelineScript;
        this.allowedLogsDir       = allowedLogsDir;
        this.canSessionRepository = canSessionRepository;
        this.messagingTemplate    = messagingTemplate;
        this.influxWriteService   = influxWriteService;
        this.carService           = carService;
    }

    private record SimulatorEntry(
            Process process,
            LocalDateTime startedAt,
            String mode,
            String sessionId,
            String sourceFilename
    ) {}

    private final Map<String, SimulatorEntry> runningSimulators = new ConcurrentHashMap<>();

    // Dedicated scheduler for the delayed frame-count backfill in markSessionComplete() —
    // keeps it off ForkJoinPool.commonPool(), which is shared JVM-wide (parallel streams, etc.)
    // and otherwise gets a thread tied up in Thread.sleep(4000) per simulator stop.
    private final ScheduledExecutorService backfillScheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "simulator-backfill-scheduler");
        t.setDaemon(true);
        return t;
    });

    // ── Start ─────────────────────────────────────────────────────────────────

    /**
     * Builds the Python command, spawns the subprocess, and tracks it by simId.
     * Path traversal on logFile is rejected before the process is created.
     *
     * @throws ResponseStatusException HTTP 400 if logFile escapes allowedLogsDir
     * @throws Exception for any I/O failure launching the process
     */
    public SimulatorStartResult startSimulator(SimulatorStartRequest config) throws Exception {
        cleanupDeadProcesses();

        String simulatorScript = pipelineScript.replace("pipeline.py", "can_simulator.py");
        String mode    = config.mode()  != null ? config.mode()  : "random";
        String logFile = config.logFile() != null ? config.logFile() : "";
        double speed   = config.speed()  != null ? config.speed()  : 1.0;
        boolean loop              = Boolean.TRUE.equals(config.loop());
        boolean injectValueErrors = Boolean.TRUE.equals(config.injectValueErrors());
        boolean injectTimingGaps  = Boolean.TRUE.equals(config.injectTimingGaps());
        boolean injectCounterErrors = Boolean.TRUE.equals(config.injectCounterErrors());
        boolean injectDuplicates = Boolean.TRUE.equals(config.injectDuplicates());
        double faultRate = config.faultRate() != null ? config.faultRate() : 0.05;

        List<String> cmd = new ArrayList<>();
        cmd.add(pythonExecutable);
        cmd.add(simulatorScript);
        cmd.add("--mode");   cmd.add(mode);
        cmd.add("--speed");  cmd.add(String.valueOf(speed));
        cmd.add("--fault-rate"); cmd.add(String.valueOf(faultRate));

        if ("replay".equals(mode) && !logFile.isEmpty()) {
            Path safeLogPath = validateLogFilePath(logFile);
            cmd.add("--log"); cmd.add(safeLogPath.toString());
        }

        if (loop)                cmd.add("--loop");
        if (injectValueErrors)   cmd.add("--inject-value-errors");
        if (injectTimingGaps)    cmd.add("--inject-timing-gaps");
        if (injectCounterErrors) cmd.add("--inject-counter-errors");
        if (injectDuplicates)    cmd.add("--inject-duplicates");

        String carUid = config.carUid();
        if (carUid != null && !carUid.isBlank()) {
            cmd.add("--car-uid"); cmd.add(carUid);

            // Restrict generated traffic to the car's assigned catalogs.
            // Empty assignment = all catalogs (legacy behaviour).
            List<String> catalogFiles = carService.getAssignedCatalogFilenames(carUid);
            if (!catalogFiles.isEmpty()) {
                cmd.add("--catalog-files");
                cmd.add(String.join(",", catalogFiles));
                log.info("Simulator for car {} restricted to catalogs: {}", carUid, catalogFiles);
            }
        }

        // Generate the session ID here and hand it to the Python process so the
        // stop path can complete the exact session this simulator created —
        // previously stop only ever completed the latest "live_simulation"
        // session, so replay sessions were never marked COMPLETE from the UI.
        String sessionId = UUID.randomUUID().toString();
        cmd.add("--session-id"); cmd.add(sessionId);
        String sourceFilename = "replay".equals(mode) && !logFile.isEmpty()
                ? Paths.get(logFile).getFileName().toString()
                : "live_simulation";

        String simId = UUID.randomUUID().toString();
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        runningSimulators.put(simId,
                new SimulatorEntry(process, LocalDateTime.now(), mode, sessionId, sourceFilename));

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
        return new SimulatorStartResult(simId, "started", mode);
    }

    // ── Stop one ──────────────────────────────────────────────────────────────

    /**
     * Destroys the simulator process and marks the live_simulation session COMPLETE.
     * Returns empty when simId is unknown so the controller can respond with 404.
     */
    public Optional<Map<String, String>> stopSimulator(String simId) {
        SimulatorEntry entry = runningSimulators.remove(simId);
        if (entry == null) return Optional.empty();

        entry.process().destroyForcibly();
        log.info("Simulator stopped: id={}", simId);

        markSessionComplete(entry);

        return Optional.of(Map.of("simId", simId, "status", "stopped"));
    }

    // ── Stop all ─────────────────────────────────────────────────────────────

    /** Destroys every running simulator process. Returns the number stopped. */
    public int stopAll() {
        int count = runningSimulators.size();
        runningSimulators.forEach((id, entry) -> {
            entry.process().destroyForcibly();
            markSessionComplete(entry);
        });
        runningSimulators.clear();
        return count;
    }

    // ── Status ────────────────────────────────────────────────────────────────

    public SimulatorStatusResult getStatus() {
        cleanupDeadProcesses();

        List<SimulatorEntryDto> simulatorList = new ArrayList<>();
        runningSimulators.forEach((simId, entry) -> simulatorList.add(new SimulatorEntryDto(
                simId,
                entry.process().isAlive(),
                entry.process().pid(),
                entry.startedAt().toString(),
                entry.mode(),
                null
        )));

        if (!simulatorList.isEmpty()) {
            SimulatorEntryDto first = simulatorList.get(0);
            return new SimulatorStatusResult(
                    simulatorList, simulatorList.size(),
                    first.running(), first.pid(), first.startedAt(), first.mode(), first.simId()
            );
        }
        return new SimulatorStatusResult(simulatorList, 0, false, null, null, null, null);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Validates that logFile resolves inside allowedLogsDir.
     * Rejects any path that escapes the sandbox (e.g. ../../etc/passwd).
     *
     * @throws ResponseStatusException HTTP 400 on path traversal attempt
     */
    private Path validateLogFilePath(String logFile) {
        Path base     = Paths.get(allowedLogsDir).toAbsolutePath().normalize();
        Path resolved = base.resolve(logFile).normalize();
        if (!resolved.startsWith(base)) {
            log.warn("Path traversal attempt blocked: logFile='{}' resolved='{}'",
                    logFile, resolved);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid log file path");
        }
        return resolved;
    }

    private void cleanupDeadProcesses() {
        runningSimulators.entrySet().removeIf(e -> !e.getValue().process().isAlive());
    }

    /**
     * Marks the stopped simulator's session COMPLETE and backfills its frame count.
     * The process is killed forcibly, so the Python-side terminal session-meta never
     * fires — the backend must close the session itself.
     * <p>
     * Primary target is the exact session ID handed to the process via --session-id.
     * Loop-mode replay mints a NEW session per pass, so the latest session for the
     * same source file is also closed if it is still open.
     */
    private void markSessionComplete(SimulatorEntry entry) {
        try {
            java.util.Set<String> completed = new java.util.HashSet<>();
            canSessionRepository.findBySessionId(entry.sessionId())
                    .filter(s -> !"COMPLETE".equals(s.getStatus()))
                    .ifPresent(s -> {
                        completeSession(s);
                        completed.add(s.getSessionId());
                    });
            canSessionRepository
                    .findTopBySourceFilenameOrderByCreatedAtDesc(entry.sourceFilename())
                    .filter(s -> !completed.contains(s.getSessionId()))
                    .filter(s -> !"COMPLETE".equals(s.getStatus()))
                    .ifPresent(this::completeSession);
        } catch (Exception e) {
            log.warn("Could not mark session complete: {}", e.getMessage());
        }
    }

    /** Sets COMPLETE, broadcasts it, and schedules the frame-count backfill. */
    private void completeSession(CanSessionEntity session) {
        session.setStatus("COMPLETE");
        canSessionRepository.save(session);
        log.info("Marked session COMPLETE: {} ({})", session.getSessionId(), session.getSourceFilename());
        try {
            String payload = String.format(
                    "{\"session_id\":\"%s\",\"status\":\"COMPLETE\"}",
                    session.getSessionId());
            messagingTemplate.convertAndSend("/topic/sessions", payload);
            log.info("[WS] Broadcast COMPLETE for session {}", session.getSessionId());
        } catch (Exception wsEx) {
            log.warn("Could not broadcast COMPLETE: {}", wsEx.getMessage());
        }

        // Python async writes haven't landed yet — wait, then backfill frame count.
        // delayedExecutor schedules the delay itself (no thread parked in
        // Thread.sleep()); the work then runs on backfillScheduler, never on
        // the shared ForkJoinPool.commonPool().
        Long entityId = session.getId();
        String sessionId = session.getSessionId();
        CompletableFuture.runAsync(() -> {
            try {
                long count = influxWriteService.countFrames(sessionId, null, null, null);
                if (count > 0) {
                    canSessionRepository.findById(entityId).ifPresent(s -> {
                        s.setFrameCount((int) count);
                        canSessionRepository.save(s);
                        log.info("Backfilled frameCount={} for session {}", count, sessionId);
                    });
                }
            } catch (Exception ex) {
                log.warn("Could not backfill frame count for session {}: {}", sessionId, ex.getMessage());
            }
        }, CompletableFuture.delayedExecutor(4, TimeUnit.SECONDS, backfillScheduler));
    }
}
