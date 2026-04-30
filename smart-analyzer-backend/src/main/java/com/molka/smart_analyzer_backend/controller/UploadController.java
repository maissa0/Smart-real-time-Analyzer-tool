package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.dto.UploadResponse;
import com.molka.smart_analyzer_backend.service.AnalysisService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/uploads")
public class UploadController {

	private final AnalysisService analysisService;

	public UploadController(AnalysisService analysisService) {
		this.analysisService = analysisService;
	}

	// ── GET /api/uploads ──────────────────────────────────────────────────────
	// Returns all log files the current user has uploaded.

	@GetMapping
	public ResponseEntity<List<UploadResponse>> getMyUploads(Authentication auth) {
		return ResponseEntity.ok(analysisService.getUploads(auth.getName()));
	}

	// ── GET /api/uploads/{id}/reanalyze ───────────────────────────────────────
	// Re-runs analysis on a previously uploaded file without re-uploading.
	// Returns the same format as POST /api/analyze.

	@GetMapping("/{id}/reanalyze")
	public ResponseEntity<?> reanalyze(@PathVariable Long id, Authentication auth) {
		try {
			Map<String, Object> result = analysisService.reanalyze(id, auth.getName());
			return ResponseEntity.ok(result);
		} catch (IllegalArgumentException ex) {
			return ResponseEntity.status(HttpStatus.FORBIDDEN)
					.body(Map.of("error", ex.getMessage()));
		} catch (Exception ex) {
			String msg = ex.getMessage() != null ? ex.getMessage() : "Reanalysis failed";
			return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
					.body(Map.of("error", msg));
		}
	}
}
