package com.molka.smart_analyzer_backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.molka.smart_analyzer_backend.dto.UploadResponse;
import com.molka.smart_analyzer_backend.entity.UploadRecord;
import com.molka.smart_analyzer_backend.repository.UploadRepository;
import com.molka.smart_analyzer_backend.storage.StorageService;
import org.springframework.kafka.core.KafkaTemplate;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.locks.ReentrantLock;
import java.util.stream.Collectors;

@Service
public class AnalysisService {

	private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);
	private final ObjectMapper                  objectMapper;
	private final SimpMessagingTemplate         messaging;
	private final StorageService                storageService;
	private final UploadRepository              uploadRepository;
	private final KafkaTemplate<String, Object> kafkaTemplate;

	// ── Warm worker state ──────────────────────────────────────────────────────
	// One Python process kept alive for the lifetime of the Spring Boot app.
	// XML catalog is loaded once at startup; each analysis job sends a log-file
	// path via stdin and reads decoded frames back from stdout.
	// Access is serialized by workerLock — requests queue up naturally.

	private Process        workerProcess;
	private PrintWriter    workerStdin;
	private BufferedReader workerStdout;
	private final ReentrantLock workerLock = new ReentrantLock();
	private volatile boolean    workerReady = false;
	private String              pythonCmd;
	private List<String>        workerXmlNames = new ArrayList<>();

	// ── Kafka worker state ────────────────────────────────────────────────────
	// A separate long-running Python process (parser.py --kafka-worker) that
	// consumes jobs from 'file-processing-jobs', decodes each CAN log file, and
	// publishes frames to 'can-frames-decoded' and events to 'log-file-events'.
	// AsyncAnalysisConsumer then forwards those to Angular via WebSocket.

	private Process kafkaWorkerProcess;

	public AnalysisService(ObjectMapper objectMapper, SimpMessagingTemplate messaging,
			StorageService storageService, UploadRepository uploadRepository,
			KafkaTemplate<String, Object> kafkaTemplate) {
		this.objectMapper     = objectMapper;
		this.messaging        = messaging;
		this.storageService   = storageService;
		this.uploadRepository = uploadRepository;
		this.kafkaTemplate    = kafkaTemplate;
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	@PostConstruct
	public void startWorker() {
		pythonCmd = detectPython();
		if (pythonCmd == null) {
			log.warn("Python not found at startup — will cold-start a new process per request.");
			return;
		}
		try {
			launchWorkerProcess();
		} catch (Exception e) {
			log.warn("Python warm worker failed to start ({}); will cold-start per request.", e.getMessage());
		}
		try {
			launchKafkaWorkerProcess();
		} catch (Exception e) {
			log.warn("Python Kafka worker failed to start ({}); async/Kafka mode will not work.", e.getMessage());
		}
	}

	@PreDestroy
	public void stopWorker() {
		if (workerProcess != null && workerProcess.isAlive()) {
			workerProcess.destroyForcibly();
			log.info("Python warm worker stopped.");
		}
		if (kafkaWorkerProcess != null && kafkaWorkerProcess.isAlive()) {
			kafkaWorkerProcess.destroyForcibly();
			log.info("Python Kafka worker stopped.");
		}
	}

	// ── Worker launch / restart ────────────────────────────────────────────────

	private void launchWorkerProcess() throws IOException {
		List<Path> xmlPaths = discoverXmlFiles();
		if (xmlPaths.isEmpty()) {
			log.warn("No XML files found in python_parser/ — Python worker not started.");
			return;
		}

		Path scriptPath = resolveScriptPath();
		List<String> cmd = new ArrayList<>();
		cmd.add(pythonCmd);
		cmd.add(scriptPath.toString());
		cmd.add("--worker");
		xmlPaths.forEach(p -> cmd.add(p.toString()));

		ProcessBuilder pb = new ProcessBuilder(cmd);
		pb.redirectErrorStream(false);
		pb.environment().put("PYTHONUNBUFFERED", "1");

		workerProcess = pb.start();

		// Drain stderr on a daemon thread so pipe never blocks
		Thread stderrDrain = new Thread(() -> {
			try (BufferedReader r = new BufferedReader(
					new InputStreamReader(workerProcess.getErrorStream(), StandardCharsets.UTF_8))) {
				String line;
				while ((line = r.readLine()) != null) {
					log.warn("[python-worker] {}", line);
				}
			} catch (IOException ignored) {}
		}, "python-worker-stderr");
		stderrDrain.setDaemon(true);
		stderrDrain.start();

		workerStdin  = new PrintWriter(
				new OutputStreamWriter(workerProcess.getOutputStream(), StandardCharsets.UTF_8), true);
		workerStdout = new BufferedReader(
				new InputStreamReader(workerProcess.getInputStream(), StandardCharsets.UTF_8));

		// Wait up to 60 s for Python to load XML files and send __WORKER_READY__
		long deadline = System.currentTimeMillis() + 60_000L;
		while (System.currentTimeMillis() < deadline) {
			String line = workerStdout.readLine();
			if (line == null) {
				throw new IOException("Worker process exited before sending __WORKER_READY__");
			}
			if (line.equals("__READY__")) {
				workerReady    = true;
				workerXmlNames = xmlPaths.stream()
						.map(p -> p.getFileName().toString())
						.collect(Collectors.toList());
				log.info("Python worker ready — {} XML file(s): {}",
						xmlPaths.size(), String.join(", ", workerXmlNames));
				return;
			}
			log.debug("[worker init] {}", line);
		}
		throw new IOException("Timed out waiting for __WORKER_READY__ (60 s)");
	}

	/** Called under workerLock — restarts the process if it has died. */
	private void ensureWorkerAlive() {
		if (workerProcess != null && workerProcess.isAlive()) return;
		log.warn("Python warm worker is not running — attempting restart…");
		workerReady = false;
		try {
			launchWorkerProcess();
		} catch (Exception e) {
			throw new RuntimeException("Failed to restart Python warm worker: " + e.getMessage(), e);
		}
	}

	/**
	 * Launches the long-running Python Kafka worker (parser.py --kafka-worker).
	 * It auto-discovers XML files from the python_parser/ directory, then loops
	 * forever consuming from 'file-processing-jobs' and publishing results back
	 * to 'can-frames-decoded' and 'log-file-events'.
	 */
	private void launchKafkaWorkerProcess() throws IOException {
		Path scriptPath = resolveScriptPath();
		List<String> cmd = new ArrayList<>();
		cmd.add(pythonCmd);
		cmd.add(scriptPath.toString());
		cmd.add("--kafka-worker");
		// No XML paths supplied — parser.py auto-discovers from its own directory

		ProcessBuilder pb = new ProcessBuilder(cmd);
		pb.redirectErrorStream(false);
		pb.environment().put("PYTHONUNBUFFERED", "1");
		// Run from python_parser/ so auto-discovery finds the XML files
		pb.directory(resolvePythonParserDir().toFile());

		kafkaWorkerProcess = pb.start();

		// Drain stdout — log INFO so progress messages are visible
		Thread stdoutDrain = new Thread(() -> {
			try (BufferedReader r = new BufferedReader(
					new InputStreamReader(kafkaWorkerProcess.getInputStream(), StandardCharsets.UTF_8))) {
				String line;
				while ((line = r.readLine()) != null) log.info("[kafka-worker] {}", line);
			} catch (IOException ignored) {}
		}, "kafka-worker-stdout");
		stdoutDrain.setDaemon(true);
		stdoutDrain.start();

		// Drain stderr — log WARN
		Thread stderrDrain = new Thread(() -> {
			try (BufferedReader r = new BufferedReader(
					new InputStreamReader(kafkaWorkerProcess.getErrorStream(), StandardCharsets.UTF_8))) {
				String line;
				while ((line = r.readLine()) != null) log.warn("[kafka-worker] {}", line);
			} catch (IOException ignored) {}
		}, "kafka-worker-stderr");
		stderrDrain.setDaemon(true);
		stderrDrain.start();

		log.info("Python Kafka worker launched (pid={})", kafkaWorkerProcess.pid());
	}

	// ── BATCH MODE ────────────────────────────────────────────────────────────
	// Routes through warm worker when available; falls back to cold-start.
	// When sessionId is provided, frames are pushed via WebSocket at 60Hz and
	// the HTTP response contains only metadata (no frames array).

	public Map<String, Object> analyzeFiles(MultipartFile logFile, String sessionId, String username) {
		Path sessionDir = null;
		try {
			sessionDir = Files.createTempDirectory("can_batch_");
			Path savedLog = saveToDir(sessionDir, logFile);

			Map<String, Object> result = workerReady
					? analyzeFilesViaWorker(savedLog)
					: analyzeFilesColdStart(savedLog);

			// Persist the log file to storage and record the upload
			if (username != null && !username.isBlank()) {
				persistUpload(savedLog, logFile.getOriginalFilename(), username,
						(Integer) result.getOrDefault("totalFrames", 0));
			}

			if (sessionId != null && !sessionId.isBlank()) {
				// Push frames via WebSocket at 60Hz; strip them from HTTP response
				@SuppressWarnings("unchecked")
				List<Map<String, Object>> frames =
						(List<Map<String, Object>>) result.remove("frames");
				Map<String, Object> errorReport =
						(Map<String, Object>) result.getOrDefault("errorReport", new HashMap<>());

				pushFramesAt60Hz(sessionId, frames, errorReport);
			}

			return result;

		} catch (Exception e) {
			log.error("Batch analysis failed", e);
			throw new RuntimeException(e.getMessage(), e);
		} finally {
			if (sessionDir != null) deleteDirectory(sessionDir);
		}
	}

	// ── Upload persistence ────────────────────────────────────────────────────

	private void persistUpload(Path logPath, String originalFilename,
			String username, int frameCount) {
		try {
			String fn  = (originalFilename != null && !originalFilename.isBlank())
					? Paths.get(originalFilename).getFileName().toString()
					: logPath.getFileName().toString();
			String key = "logs/" + username + "/" + System.currentTimeMillis() + "_" + fn;

			String address;
			try (InputStream in = Files.newInputStream(logPath)) {
				address = storageService.store(in, Files.size(logPath), key, "application/octet-stream");
			}

			UploadRecord record = new UploadRecord();
			record.setUsername(username);
			record.setOriginalFilename(fn);
			record.setStorageAddress(address);
			record.setFrameCount(frameCount);
			uploadRepository.save(record);
			log.info("Saved upload record for '{}': key={}", username, address);

		} catch (Exception e) {
			// Do not fail the analysis if storage is unavailable
			log.warn("Failed to persist upload for user '{}': {}", username, e.getMessage());
		}
	}

	// ── Upload list & re-analysis ─────────────────────────────────────────────

	public List<UploadResponse> getUploads(String username) {
		return uploadRepository.findByUsernameOrderByUploadedAtDesc(username)
				.stream()
				.map(r -> new UploadResponse(r.getId(), r.getOriginalFilename(),
						r.getUploadedAt(), r.getFrameCount()))
				.collect(Collectors.toList());
	}

	// ── ASYNC MODE (Kafka) ────────────────────────────────────────────────────
	// Saves the log file to disk and publishes a job to 'file-processing-jobs'.
	// The Python kafka worker picks it up, processes the file, and publishes
	// decoded frames back to 'can-frames-decoded' (keyed by sessionId).
	// AsyncAnalysisConsumer forwards those frames to WebSocket topic
	// /topic/async-frames/{sessionId} which the Angular client subscribes to.

	public Map<String, Object> submitAsyncJob(MultipartFile logFile, String sessionId) throws Exception {
		// Ensure Kafka worker is alive before submitting — restart if it crashed
		if (pythonCmd != null && (kafkaWorkerProcess == null || !kafkaWorkerProcess.isAlive())) {
			log.warn("Kafka worker not running — restarting before submitting job {}", sessionId);
			try {
				launchKafkaWorkerProcess();
			} catch (Exception e) {
				log.error("Failed to restart Kafka worker: {}", e.getMessage());
			}
		}

		Path asyncJobsDir = resolveAsyncJobsDir();
		Path jobDir = asyncJobsDir.resolve(sessionId);
		Files.createDirectories(jobDir);

		String original = logFile.getOriginalFilename();
		String filename  = (original == null || original.isBlank())
				? "upload.bin"
				: Paths.get(original).getFileName().toString();
		Path savedFile = jobDir.resolve(filename);
		try (InputStream in = logFile.getInputStream()) {
			Files.copy(in, savedFile, StandardCopyOption.REPLACE_EXISTING);
		}

		List<Path> xmlPaths    = discoverXmlFiles();
		List<String> xmlNames  = xmlPaths.stream()
				.map(p -> p.getFileName().toString())
				.collect(Collectors.toList());

		Map<String, Object> job = new HashMap<>();
		job.put("sessionId",       sessionId);
		job.put("filePath",        savedFile.toString());
		job.put("sourceFilename",  filename);

		kafkaTemplate.send("file-processing-jobs", sessionId, job);
		log.info("Submitted async job: sessionId={}, file={}", sessionId, savedFile);

		Map<String, Object> response = new HashMap<>();
		response.put("sessionId",    sessionId);
		response.put("xmlFilesUsed", xmlNames);
		return response;
	}

	private Path resolveAsyncJobsDir() {
		return resolvePythonParserDir().getParent()
				.resolve("uploads").resolve("async-jobs").toAbsolutePath().normalize();
	}

	public Map<String, Object> reanalyze(Long uploadId, String username) throws Exception {
		UploadRecord record = uploadRepository.findById(uploadId)
				.orElseThrow(() -> new IllegalArgumentException("Upload not found: " + uploadId));
		if (!record.getUsername().equals(username)) {
			throw new IllegalArgumentException("Access denied.");
		}

		Path sessionDir = Files.createTempDirectory("can_reanalyze_");
		try {
			Path tempLog = sessionDir.resolve(record.getOriginalFilename());
			try (InputStream is = storageService.load(record.getStorageAddress())) {
				Files.copy(is, tempLog, StandardCopyOption.REPLACE_EXISTING);
			}
			return workerReady
					? analyzeFilesViaWorker(tempLog)
					: analyzeFilesColdStart(tempLog);
		} finally {
			deleteDirectory(sessionDir);
		}
	}

	// ── 60Hz WebSocket frame delivery ─────────────────────────────────────────
	// Pushes decoded frames to /topic/batch-frames/{sessionId} in batches of 50,
	// one batch every 16ms (~60Hz).  Runs on a daemon background thread so the
	// HTTP response is returned immediately.

	private void pushFramesAt60Hz(String sessionId,
								  List<Map<String, Object>> frames,
								  Map<String, Object> errorReport) {
		Thread pusher = new Thread(() -> {
			try {
				final int BATCH_SIZE = 50;
				int total = frames.size();

				// Always send at least one message so Angular receives done=true
				// even when the file contains no parseable frames.
				if (total == 0) {
					Map<String, Object> msg = new HashMap<>();
					msg.put("sessionId",   sessionId);
					msg.put("frames",      List.of());
					msg.put("done",        true);
					msg.put("errorReport", errorReport);
					messaging.convertAndSend("/topic/batch-frames/" + sessionId, msg);
					log.info("60Hz push complete: 0 frames → session {}", sessionId);
					return;
				}

				for (int i = 0; i < total; i += BATCH_SIZE) {
					int end  = Math.min(i + BATCH_SIZE, total);
					boolean done = end >= total;

					Map<String, Object> msg = new HashMap<>();
					msg.put("sessionId", sessionId);
					msg.put("frames",    frames.subList(i, end));
					msg.put("done",      done);
					if (done) msg.put("errorReport", errorReport);

					messaging.convertAndSend("/topic/batch-frames/" + sessionId, msg);

					if (!done) Thread.sleep(16);
				}
				log.info("60Hz push complete: {} frames → session {}", total, sessionId);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			} catch (Exception e) {
				log.error("60Hz push failed for session {}", sessionId, e);
			}
		}, "ws-batch-" + sessionId);
		pusher.setDaemon(true);
		pusher.start();
	}

	private Map<String, Object> analyzeFilesViaWorker(Path logPath) throws Exception {
		List<Map<String, Object>> frames      = new ArrayList<>();
		Map<String, Object>       errorReport = new HashMap<>();

		workerLock.lock();
		try {
			ensureWorkerAlive();

			workerStdin.println(objectMapper.writeValueAsString(Map.of(
					"log_path", logPath.toString(),
					"mode",     "batch"
			)));

			String line;
			while ((line = workerStdout.readLine()) != null) {
				line = line.trim();
				if (line.isEmpty()) continue;
				if (line.equals("__END__")) break;
				if (line.startsWith("__ERRORS__")) {
					errorReport = objectMapper.readValue(
							line.substring("__ERRORS__".length()), new TypeReference<>() {});
					continue;
				}
				if (line.startsWith("{")) {
					frames.add(objectMapper.readValue(line, new TypeReference<>() {}));
				}
			}
		} finally {
			workerLock.unlock();
		}

		log.info("Worker batch: {} frames from {}", frames.size(), logPath.getFileName());

		Map<String, Object> result = new HashMap<>();
		result.put("frames",      frames);
		result.put("errorReport", errorReport);
		result.put("totalFrames", frames.size());
		result.put("xmlFilesUsed", workerXmlNames);
		return result;
	}

	private Map<String, Object> analyzeFilesColdStart(Path logPath) throws Exception {
		List<Path> xmlPaths = discoverXmlFiles();
		if (xmlPaths.isEmpty()) {
			throw new RuntimeException(
					"No XML files found in python_parser/ directory. " +
					"Please add your signal definition XML files there.");
		}
		log.info("Cold-start batch: auto-discovered {} XML file(s)", xmlPaths.size());

		runParser(logPath, xmlPaths);

		Path sessionDir  = logPath.getParent();
		Path decodedPath = sessionDir.resolve("decoded_frames.json");
		if (!decodedPath.toAbsolutePath().startsWith(sessionDir.toAbsolutePath())) {
			throw new RuntimeException("Security: decoded_frames.json resolved outside temp dir: " + decodedPath);
		}
		if (!Files.exists(decodedPath)) {
			throw new RuntimeException(
					"Parser did not write decoded_frames.json to: " + decodedPath);
		}

		List<Map<String, Object>> frames = objectMapper.readValue(
				Files.readString(decodedPath, StandardCharsets.UTF_8),
				new TypeReference<>() {});

		Map<String, Object> errorReport = new HashMap<>();
		Path errorPath = sessionDir.resolve("error_report.json");
		if (Files.exists(errorPath)) {
			errorReport = objectMapper.readValue(
					Files.readString(errorPath, StandardCharsets.UTF_8),
					new TypeReference<>() {});
		}

		Map<String, Object> result = new HashMap<>();
		result.put("frames",      frames);
		result.put("errorReport", errorReport);
		result.put("totalFrames", frames.size());
		result.put("xmlFilesUsed", xmlPaths.stream()
				.map(p -> p.getFileName().toString()).collect(Collectors.toList()));
		return result;
	}

	// ── STREAMING MODE ────────────────────────────────────────────────────────
	// Routes through warm worker when available; falls back to cold-start.

	public SseEmitter streamFrames(MultipartFile logFile) throws IOException {
		SseEmitter emitter    = new SseEmitter(5 * 60 * 1000L);
		Path       sessionDir = Files.createTempDirectory("can_stream_");
		Path       savedLog   = saveToDir(sessionDir, logFile);

		ExecutorService executor = Executors.newSingleThreadExecutor();
		executor.submit(() -> {
			try {
				// Emit "connected" immediately so the browser doesn't stare at a blank screen
				emitter.send(SseEmitter.event()
						.name("ready")
						.data("{\"status\":\"connected\"}"));

				if (workerReady) {
					streamFramesViaWorker(savedLog, emitter);
				} else {
					streamFramesColdStart(savedLog, emitter);
				}

			} catch (Exception e) {
				log.error("Streaming failed", e);
				emitter.completeWithError(e);
			} finally {
				deleteDirectory(sessionDir);
				executor.shutdown();
			}
		});

		return emitter;
	}

	private void streamFramesViaWorker(Path logPath, SseEmitter emitter) throws Exception {
		workerLock.lock();
		try {
			ensureWorkerAlive();

			workerStdin.println(objectMapper.writeValueAsString(Map.of(
					"log_path", logPath.toString(),
					"mode",     "stream"
			)));

			String line;
			while ((line = workerStdout.readLine()) != null) {
				line = line.trim();
				if (line.isEmpty()) continue;
				if (line.equals("__END__")) {
					emitter.send(SseEmitter.event().name("end").data("{\"done\":true}"));
					break;
				}
				if (line.startsWith("__ERRORS__")) {
					emitter.send(SseEmitter.event()
							.name("errors")
							.data(line.substring("__ERRORS__".length())));
					continue;
				}
				if (line.startsWith("{")) {
					emitter.send(SseEmitter.event().name("frame").data(line));
				}
			}
			emitter.complete();
		} finally {
			workerLock.unlock();
		}
	}

	private void streamFramesColdStart(Path logPath, SseEmitter emitter) throws Exception {
		List<Path> xmlPaths;
		try {
			xmlPaths = discoverXmlFiles();
			if (xmlPaths.isEmpty()) {
				emitter.completeWithError(new RuntimeException(
						"No XML files found in python_parser/ directory."));
				return;
			}
		} catch (Exception e) {
			emitter.completeWithError(e);
			return;
		}

		log.info("Cold-start stream: {} XML file(s)", xmlPaths.size());

		List<String> scriptArgs = new ArrayList<>();
		scriptArgs.add("--stream");
		scriptArgs.add(logPath.toString());
		xmlPaths.forEach(p -> scriptArgs.add(p.toString()));

		boolean ran = false;
		for (String cmd : List.of("python", "python3")) {
			if (runStream(cmd, resolveScriptPath(), scriptArgs, emitter)) {
				ran = true;
				break;
			}
		}
		if (!ran) {
			emitter.completeWithError(new RuntimeException("Python not found on this system."));
			return;
		}
		emitter.complete();
	}

	// ── Python detection ──────────────────────────────────────────────────────

	private String detectPython() {
		for (String cmd : List.of("python", "python3")) {
			try {
				Process p = new ProcessBuilder(cmd, "--version")
						.redirectErrorStream(true)
						.start();
				p.waitFor();
				if (p.exitValue() == 0) {
					log.info("Detected Python command: {}", cmd);
					return cmd;
				}
			} catch (Exception ignored) {}
		}
		return null;
	}

	// ── XML auto-discovery ────────────────────────────────────────────────────

	private List<Path> discoverXmlFiles() throws IOException {
		Path parserDir = resolvePythonParserDir();
		if (!Files.exists(parserDir)) {
			throw new RuntimeException(
					"python_parser/ directory not found at: " + parserDir);
		}
		return Files.list(parserDir)
				.filter(p -> p.toString().endsWith(".xml"))
				.sorted()
				.collect(Collectors.toList());
	}

	// ── Cold-start stream runner ──────────────────────────────────────────────

	private boolean runStream(String cmd, Path scriptPath,
							  List<String> scriptArgs, SseEmitter emitter) {
		List<String> full = new ArrayList<>();
		full.add(cmd);
		full.add(scriptPath.toString());
		full.addAll(scriptArgs);

		try {
			ProcessBuilder pb = new ProcessBuilder(full);
			pb.redirectErrorStream(false);
			pb.environment().put("PYTHONUNBUFFERED", "1");
			Process process = pb.start();

			StringBuilder stderrBuf = new StringBuilder();
			Thread stderrThread = new Thread(() -> {
				try (BufferedReader r = new BufferedReader(
						new InputStreamReader(process.getErrorStream()))) {
					String line;
					while ((line = r.readLine()) != null) {
						stderrBuf.append(line).append("\n");
						log.warn("parser.py stderr: {}", line);
					}
				} catch (IOException ignored) {}
			});
			stderrThread.setDaemon(true);
			stderrThread.start();

			try (BufferedReader reader = new BufferedReader(
					new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
				String line;
				while ((line = reader.readLine()) != null) {
					line = line.trim();
					if (line.isEmpty()) continue;
					if (line.equals("__END__")) {
						emitter.send(SseEmitter.event().name("end").data("{\"done\":true}"));
						break;
					}
					if (line.startsWith("__ERRORS__")) {
						emitter.send(SseEmitter.event()
								.name("errors")
								.data(line.substring("__ERRORS__".length())));
						continue;
					}
					if (line.startsWith("{")) {
						emitter.send(SseEmitter.event().name("frame").data(line));
					}
				}
			}

			int exitCode = process.waitFor();
			stderrThread.join(2000);
			if (exitCode != 0) log.warn("parser.py exited {}: {}", exitCode, stderrBuf);
			return true;

		} catch (Exception e) {
			if (e instanceof InterruptedException) Thread.currentThread().interrupt();
			return false;
		}
	}

	// ── Cold-start batch runner ───────────────────────────────────────────────

	private void runParser(Path logPath, List<Path> xmlPaths)
			throws IOException, InterruptedException {
		Path scriptPath = resolveScriptPath();
		List<String> args = new ArrayList<>();
		args.add(scriptPath.toString());
		args.add(logPath.toString());
		for (Path p : xmlPaths) args.add(p.toString());

		ProcessResult result = tryRunPython("python", args);
		if (result == null) result = tryRunPython("python3", args);
		if (result == null) throw new RuntimeException("Python not found on this system.");

		log.info("parser.py stdout:\n{}", result.stdout);
		if (!result.stderr.isBlank()) log.warn("parser.py stderr:\n{}", result.stderr);
		if (result.exitCode != 0) {
			String msg = result.stderr.isBlank() ? result.stdout : result.stderr;
			throw new RuntimeException(msg);
		}
	}

	// ── Path helpers ──────────────────────────────────────────────────────────

	private Path resolvePythonParserDir() {
		Path backendRoot = Paths.get("").toAbsolutePath();
		Path repoRoot    = backendRoot.getParent() != null ? backendRoot.getParent() : backendRoot;
		return repoRoot.resolve("python_parser").toAbsolutePath().normalize();
	}

	private Path resolveScriptPath() {
		return resolvePythonParserDir().resolve("parser.py");
	}

	private Path saveToDir(Path dir, MultipartFile file) throws IOException {
		String original = file.getOriginalFilename();
		String filename = (original == null || original.isBlank())
				? "upload.bin"
				: Paths.get(original).getFileName().toString();
		Path dest = dir.resolve(filename);
		try (InputStream in = file.getInputStream()) {
			Files.copy(in, dest, StandardCopyOption.REPLACE_EXISTING);
		}
		return dest.toAbsolutePath().normalize();
	}

	// ── Python batch process runner ───────────────────────────────────────────

	private ProcessResult tryRunPython(String cmd, List<String> args) {
		List<String> full = new ArrayList<>();
		full.add(cmd);
		full.addAll(args);
		try {
			ProcessBuilder pb = new ProcessBuilder(full);
			Process p = pb.start();
			String out = readAll(p.getInputStream());
			String err = readAll(p.getErrorStream());
			int code   = p.waitFor();
			return new ProcessResult(code, out, err);
		} catch (Exception e) {
			if (e instanceof InterruptedException) Thread.currentThread().interrupt();
			return null;
		}
	}

	private String readAll(InputStream in) throws IOException {
		try (in) {
			ByteArrayOutputStream out = new ByteArrayOutputStream();
			byte[] buf = new byte[8192];
			int r;
			while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
			return out.toString(StandardCharsets.UTF_8);
		}
	}

	private void deleteDirectory(Path dir) {
		try {
			Files.walk(dir)
					.sorted(Comparator.reverseOrder())
					.map(Path::toFile)
					.forEach(File::delete);
		} catch (IOException ignored) {}
	}

	private record ProcessResult(int exitCode, String stdout, String stderr) {}
}
