package com.molka.smart_analyzer_backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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
	private final ObjectMapper          objectMapper;
	private final SimpMessagingTemplate messaging;

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

	public AnalysisService(ObjectMapper objectMapper, SimpMessagingTemplate messaging) {
		this.objectMapper = objectMapper;
		this.messaging    = messaging;
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
			log.warn("Python worker failed to start ({}); will cold-start per request.", e.getMessage());
		}
	}

	@PreDestroy
	public void stopWorker() {
		if (workerProcess != null && workerProcess.isAlive()) {
			workerProcess.destroyForcibly();
			log.info("Python worker stopped.");
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
		log.warn("Python worker is not running — attempting restart…");
		workerReady = false;
		try {
			launchWorkerProcess();
		} catch (Exception e) {
			throw new RuntimeException("Failed to restart Python worker: " + e.getMessage(), e);
		}
	}

	// ── BATCH MODE ────────────────────────────────────────────────────────────
	// Routes through warm worker when available; falls back to cold-start.
	// When sessionId is provided, frames are pushed via WebSocket at 60Hz and
	// the HTTP response contains only metadata (no frames array).

	public Map<String, Object> analyzeFiles(MultipartFile logFile, String sessionId) {
		Path sessionDir = null;
		try {
			sessionDir = Files.createTempDirectory("can_batch_");
			Path savedLog = saveToDir(sessionDir, logFile);

			Map<String, Object> result = workerReady
					? analyzeFilesViaWorker(savedLog)
					: analyzeFilesColdStart(savedLog);

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
