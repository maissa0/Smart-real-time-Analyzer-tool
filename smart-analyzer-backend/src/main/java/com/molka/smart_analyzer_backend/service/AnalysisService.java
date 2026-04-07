package com.molka.smart_analyzer_backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class AnalysisService {

	private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);
	private final ObjectMapper objectMapper;

	public AnalysisService(ObjectMapper objectMapper) {
		this.objectMapper = objectMapper;
	}

	// ── ORIGINAL METHOD — completely unchanged ────────────────────────────────

	public List<Map<String, Object>> analyzeFiles(
			MultipartFile logFile, List<MultipartFile> xmlFiles) {
		try {
			Path uploadsDir = getUploadsDir();
			Files.createDirectories(uploadsDir);

			Path savedLog = saveToUploads(uploadsDir, logFile);
			List<Path> savedXmls = new ArrayList<>();
			for (MultipartFile xml : xmlFiles) {
				savedXmls.add(saveToUploads(uploadsDir, xml));
			}

			runParser(savedLog, savedXmls);

			Path decodedPath = uploadsDir.resolve("decoded_frames.json");
			String json = Files.readString(decodedPath, StandardCharsets.UTF_8);
			return objectMapper.readValue(json,
					new TypeReference<List<Map<String, Object>>>() {});

		} catch (Exception e) {
			log.error("Analysis failed", e);
			throw new RuntimeException(e.getMessage(), e);
		}
	}

	// ── NEW: STREAMING METHOD ─────────────────────────────────────────────────
	// Saves uploaded files to a temp session dir, spawns Python with --stream
	// in a background thread, reads stdout line by line and sends each decoded
	// frame as an SSE event to Angular immediately — no waiting for all frames.

	public SseEmitter streamFrames(
			MultipartFile logFile, List<MultipartFile> xmlFiles) throws IOException {

		SseEmitter emitter = new SseEmitter(5 * 60 * 1000L);

		// Use a separate temp dir per streaming session to avoid conflicts
		// with the shared uploads/ dir used by batch mode
		Path sessionDir = Files.createTempDirectory("can_stream_");
		Path savedLog   = saveToDir(sessionDir, logFile);
		List<Path> savedXmls = new ArrayList<>();
		for (MultipartFile xml : xmlFiles) {
			savedXmls.add(saveToDir(sessionDir, xml));
		}

		ExecutorService executor = Executors.newSingleThreadExecutor();
		executor.submit(() -> {
			try {
				Path scriptPath = resolveScriptPath();

				List<String> scriptArgs = new ArrayList<>();
				scriptArgs.add("--stream");
				scriptArgs.add(savedLog.toString());
				savedXmls.forEach(p -> scriptArgs.add(p.toString()));

				boolean ran = false;
				for (String cmd : List.of("python", "python3")) {
					if (runStream(cmd, scriptPath, scriptArgs, emitter)) {
						ran = true;
						break;
					}
				}

				if (!ran) {
					emitter.completeWithError(
							new RuntimeException("Python not found on this system."));
					return;
				}

				emitter.complete();

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

	// Tries to run Python with the given command, streams stdout to emitter.
	// Returns true if Python was found and ran (regardless of exit code).
	// Returns false if Python executable was not found.
	private boolean runStream(String cmd, Path scriptPath,
							  List<String> scriptArgs, SseEmitter emitter) {

		List<String> full = new ArrayList<>();
		full.add(cmd);
		full.add(scriptPath.toString());
		full.addAll(scriptArgs);

		try {
			ProcessBuilder pb = new ProcessBuilder(full);
			pb.redirectErrorStream(false);
			Process process = pb.start();

			// Read stderr in daemon thread so it never blocks stdout
			StringBuilder stderrBuf = new StringBuilder();
			Thread stderrThread = new Thread(() -> {
				try (BufferedReader r = new BufferedReader(
						new InputStreamReader(process.getErrorStream()))) {
					String line;
					while ((line = r.readLine()) != null) {
						stderrBuf.append(line).append("\n");
					}
				} catch (IOException ignored) {}
			});
			stderrThread.setDaemon(true);
			stderrThread.start();

			// Read stdout line by line — each line is one decoded frame JSON
			try (BufferedReader reader = new BufferedReader(
					new InputStreamReader(process.getInputStream(),
							StandardCharsets.UTF_8))) {
				String line;
				while ((line = reader.readLine()) != null) {
					line = line.trim();
					if (line.isEmpty()) continue;

					if (line.equals("__END__")) {
						emitter.send(SseEmitter.event()
								.name("end")
								.data("{\"done\":true}"));
						break;
					}

					if (line.startsWith("{")) {
						emitter.send(SseEmitter.event()
								.name("frame")
								.data(line));
					}
				}
			}

			int exitCode = process.waitFor();
			stderrThread.join(2000);

			if (exitCode != 0) {
				log.warn("parser.py exited {}: {}", exitCode, stderrBuf);
			}

			return true;

		} catch (Exception e) {
			if (e instanceof InterruptedException)
				Thread.currentThread().interrupt();
			return false;
		}
	}

	// ── ORIGINAL PRIVATE HELPERS — completely unchanged ───────────────────────

	private Path getUploadsDir() {
		Path backendRoot = Paths.get("").toAbsolutePath();
		Path repoRoot = backendRoot.getParent() != null
				? backendRoot.getParent() : backendRoot;
		return repoRoot.resolve("uploads");
	}

	private Path resolveScriptPath() {
		Path backendRoot = Paths.get("").toAbsolutePath();
		Path repoRoot = backendRoot.getParent() != null
				? backendRoot.getParent() : backendRoot;
		return repoRoot.resolve("python_parser")
				.resolve("parser.py")
				.toAbsolutePath()
				.normalize();
	}

	private Path saveToUploads(Path uploadsDir, MultipartFile file) throws IOException {
		return saveToDir(uploadsDir, file);
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

	private void runParser(Path logPath, List<Path> xmlPaths)
			throws IOException, InterruptedException {
		Path scriptPath = resolveScriptPath();

		List<String> args = new ArrayList<>();
		args.add(scriptPath.toString());
		args.add(logPath.toString());
		for (Path p : xmlPaths) args.add(p.toString());

		ProcessResult result = tryRunPython("python", args);
		if (result == null) result = tryRunPython("python3", args);
		if (result == null)
			throw new RuntimeException("Python not found on this system.");

		log.info("parser.py stdout:\n{}", result.stdout);
		if (!result.stderr.isBlank())
			log.warn("parser.py stderr:\n{}", result.stderr);

		if (result.exitCode != 0) {
			String msg = result.stderr.isBlank() ? result.stdout : result.stderr;
			throw new RuntimeException(msg);
		}
	}

	private ProcessResult tryRunPython(String cmd, List<String> args) {
		List<String> full = new ArrayList<>();
		full.add(cmd);
		full.addAll(args);
		try {
			ProcessBuilder pb = new ProcessBuilder(full);
			Process p = pb.start();
			String out = readAll(p.getInputStream());
			String err = readAll(p.getErrorStream());
			int code = p.waitFor();
			return new ProcessResult(code, out, err);
		} catch (Exception e) {
			if (e instanceof InterruptedException)
				Thread.currentThread().interrupt();
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