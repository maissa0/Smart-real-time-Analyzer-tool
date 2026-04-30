package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.repository.UserRepository;
import com.molka.smart_analyzer_backend.service.AnalysisService;
import com.molka.smart_analyzer_backend.service.AuditLogService;
import io.github.bucket4j.Bucket;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class AnalysisController {

	private final AnalysisService analysisService;
	private final AuditLogService auditLogService;
	private final UserRepository  userRepository;

	@Autowired private Bucket analysisRateLimiter;

	public AnalysisController(AnalysisService analysisService,
			AuditLogService auditLogService, UserRepository userRepository) {
		this.analysisService = analysisService;
		this.auditLogService = auditLogService;
		this.userRepository  = userRepository;
	}

	// ── BATCH ENDPOINT ────────────────────────────────────────────────────────
	// POST /api/analyze
	// Accepts only the log file.
	// XML files are auto-discovered from python_parser/ directory.
	// Returns { frames: [...], errorReport: {...}, totalFrames: N, xmlFilesUsed: [...] }

	@PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	public ResponseEntity<?> analyze(
			@RequestPart("logFile") MultipartFile logFile,
			@RequestPart(value = "sessionId", required = false) String sessionId,
			Authentication authentication,
			HttpServletRequest httpRequest) {
		if (!analysisRateLimiter.tryConsume(1)) {
			return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
				.body("Rate limit exceeded. Max 10 requests per minute.");
		}
		try {
			String username = authentication != null ? authentication.getName() : null;
			Map<String, Object> result = analysisService.analyzeFiles(logFile, sessionId, username);
			// Audit log the analysis
			if (username != null) {
				Long userId = userRepository.findByUsername(username).map(u -> u.getId()).orElse(null);
				Object frameCount = result.get("totalFrames");
				String details = "{\"filename\":\"" + logFile.getOriginalFilename() + "\""
						+ (frameCount != null ? ",\"frames\":" + frameCount : "") + "}";
				auditLogService.log(userId, username, "FILE_ANALYZED", "FILE",
						logFile.getOriginalFilename(), details, httpRequest);
			}
			return ResponseEntity.ok(result);
		} catch (Exception e) {
			String errorMsg = e.getMessage() == null
					? "Analysis failed"
					: e.getMessage().replaceAll("[\\r\\n]", " ");
			return ResponseEntity.status(500)
					.header("Reason", errorMsg)
					.body(Collections.singletonMap("error", errorMsg));
		}
	}

	// ── ASYNC ENDPOINT ───────────────────────────────────────────────────────
	// POST /api/analyze/async
	// Accepts a log file, saves it to disk, publishes a job to Kafka topic
	// 'file-processing-jobs', and returns {sessionId} immediately.
	// Angular then subscribes to /topic/async-frames/{sessionId} via WebSocket.

	@PostMapping(value = "/analyze/async", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	public ResponseEntity<?> analyzeAsync(
			@RequestPart("logFile") MultipartFile logFile,
			@RequestPart(value = "sessionId", required = false) String sessionId,
			Authentication authentication) {
		try {
			// Use client-supplied sessionId if present (allows subscribe-before-post);
			// fall back to server-generated UUID for backwards compatibility.
			String effectiveSessionId = (sessionId != null && !sessionId.isBlank())
					? sessionId
					: UUID.randomUUID().toString();
			Map<String, Object> result = analysisService.submitAsyncJob(logFile, effectiveSessionId);
			return ResponseEntity.ok(result);
		} catch (Exception e) {
			String msg = e.getMessage() == null ? "Failed to submit async job" : e.getMessage();
			return ResponseEntity.status(500).body(Collections.singletonMap("error", msg));
		}
	}

	// ── METADATA ENDPOINT ────────────────────────────────────────────────────
	// POST /api/analyze/metadata
	// Accepts a log file upload, runs get_ascii_metadata() via Python subprocess.
	// Returns { file_size, start_ts, end_ts, channel_count, channel_names,
	//           frame_count_estimate, format }

	@PostMapping(value = "/analyze/metadata", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	public ResponseEntity<?> analyzeMetadata(
			@RequestPart("logFile") MultipartFile logFile) {
		Path tmp = null;
		try {
			tmp = Files.createTempFile("can_log_", ".txt");
			logFile.transferTo(tmp.toFile());

			String scriptDir = System.getProperty("user.dir")
					.replace("smart-analyzer-backend", "python_parser");
			String parserPath = scriptDir + "/parser.py";

			ProcessBuilder pb = new ProcessBuilder(
					"python", parserPath, "--metadata", tmp.toString());
			pb.redirectErrorStream(true);
			Process proc = pb.start();

			StringBuilder sb = new StringBuilder();
			try (BufferedReader br = new BufferedReader(
					new InputStreamReader(proc.getInputStream()))) {
				String line;
				while ((line = br.readLine()) != null) sb.append(line);
			}
			proc.waitFor();

			com.fasterxml.jackson.databind.ObjectMapper mapper =
					new com.fasterxml.jackson.databind.ObjectMapper();
			Map<?, ?> result = mapper.readValue(sb.toString(), Map.class);
			return ResponseEntity.ok(result);

		} catch (Exception e) {
			String msg = e.getMessage() == null ? "Metadata extraction failed" : e.getMessage();
			return ResponseEntity.status(500)
					.body(Collections.singletonMap("error", msg));
		} finally {
			if (tmp != null) {
				try { Files.deleteIfExists(tmp); } catch (Exception ignored) {}
			}
		}
	}

	// ── STREAMING ENDPOINT ────────────────────────────────────────────────────
	// POST /api/analyze-stream
	// Accepts only the log file.
	// XML files are auto-discovered from python_parser/ directory.
	// Returns SSE stream:
	//   event: frame  → one decoded frame JSON
	//   event: errors → error report JSON (sent before end)
	//   event: end    → {"done":true}

	@PostMapping(
			value = "/analyze-stream",
			consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
			produces = MediaType.TEXT_EVENT_STREAM_VALUE
	)
	public SseEmitter analyzeStream(
			@RequestPart("logFile") MultipartFile logFile,
			HttpServletResponse response) {
		if (!analysisRateLimiter.tryConsume(1)) {
			response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
			SseEmitter errEmitter = new SseEmitter();
			errEmitter.complete();
			return errEmitter;
		}
		try {
			return analysisService.streamFrames(logFile);
		} catch (Exception e) {
			SseEmitter emitter = new SseEmitter();
			emitter.completeWithError(e);
			return emitter;
		}
	}
}