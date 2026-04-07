package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.service.AnalysisService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Collections;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/analyze")
@CrossOrigin(
		origins = "http://localhost:4200",
		allowCredentials = "true",
		allowedHeaders = "*",
		methods = { RequestMethod.GET, RequestMethod.POST, RequestMethod.OPTIONS }
)
public class AnalysisController {

	private final AnalysisService analysisService;

	public AnalysisController(AnalysisService analysisService) {
		this.analysisService = analysisService;
	}

	// ── ORIGINAL BATCH ENDPOINT — completely unchanged ────────────────────────
	// POST /api/analyze

	@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	public ResponseEntity<List<Map<String, Object>>> analyze(
			@RequestPart("logFile")  MultipartFile logFile,
			@RequestPart("xmlFiles") List<MultipartFile> xmlFiles) {
		try {
			List<Map<String, Object>> frames =
					analysisService.analyzeFiles(logFile, xmlFiles);
			return ResponseEntity.ok(frames);
		} catch (Exception e) {
			String errorMsg = e.getMessage() == null
					? "Analysis failed"
					: e.getMessage().replaceAll("[\\r\\n]", " ");
			return ResponseEntity.status(500)
					.header("Reason", errorMsg)
					.body(Collections.emptyList());
		}
	}

	// ── NEW STREAMING ENDPOINT ────────────────────────────────────────────────
	// POST /api/analyze-stream
	// Returns SSE — one event per decoded frame, named "frame"
	// Final event named "end" signals decoding is complete

	@PostMapping(
			value = "-stream",
			consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
			produces = MediaType.TEXT_EVENT_STREAM_VALUE
	)
	public SseEmitter analyzeStream(
			@RequestPart("logFile")  MultipartFile logFile,
			@RequestPart("xmlFiles") List<MultipartFile> xmlFiles) {
		try {
			return analysisService.streamFrames(logFile, xmlFiles);
		} catch (Exception e) {
			SseEmitter emitter = new SseEmitter();
			emitter.completeWithError(e);
			return emitter;
		}
	}
}