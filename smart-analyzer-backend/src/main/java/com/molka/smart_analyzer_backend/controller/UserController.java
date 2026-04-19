package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.dto.*;
import com.molka.smart_analyzer_backend.exception.AuthFailureException;
import com.molka.smart_analyzer_backend.service.UserService;
import jakarta.validation.Valid;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserController {

	private final UserService userService;

	public UserController(UserService userService) {
		this.userService = userService;
	}

	// ── Auth ──────────────────────────────────────────────────────────────────

	@PostMapping("/register")
	public ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterRequest request) {
		return ResponseEntity.status(HttpStatus.CREATED).body(userService.register(request));
	}

	@PostMapping("/login")
	public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request) {
		try {
			return ResponseEntity.ok(userService.login(request));
		} catch (AuthFailureException ex) {
			return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("message", ex.getMessage()));
		}
	}

	// ── Self ──────────────────────────────────────────────────────────────────

	@GetMapping("/me")
	public ResponseEntity<UserResponse> getMe(Authentication auth) {
		return ResponseEntity.ok(userService.getMe(auth.getName()));
	}

	@PutMapping("/me")
	public ResponseEntity<?> updateMe(@Valid @RequestBody UpdateMeRequest request, Authentication auth) {
		try {
			return ResponseEntity.ok(userService.updateMe(auth.getName(), request));
		} catch (IllegalArgumentException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	@PostMapping(value = "/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	public ResponseEntity<?> uploadAvatar(@RequestParam("file") MultipartFile file, Authentication auth) {
		try {
			return ResponseEntity.ok(userService.uploadAvatar(auth.getName(), file));
		} catch (Exception ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	// ── Avatar serving ────────────────────────────────────────────────────────

	@GetMapping("/avatars/{filename:.+}")
	public ResponseEntity<Resource> getAvatar(@PathVariable String filename) {
		try {
			Path file = userService.resolveAvatarsDir().resolve(filename).normalize();
			if (!Files.exists(file)) return ResponseEntity.notFound().build();
			Resource resource = new UrlResource(file.toUri());
			String contentType = Files.probeContentType(file);
			if (contentType == null) contentType = "application/octet-stream";
			return ResponseEntity.ok()
					.contentType(MediaType.parseMediaType(contentType))
					.body(resource);
		} catch (Exception ex) {
			return ResponseEntity.notFound().build();
		}
	}

	// ── Admin: CRUD ───────────────────────────────────────────────────────────

	@GetMapping
	public ResponseEntity<List<UserResponse>> getAll() {
		return ResponseEntity.ok(userService.getAll());
	}

	@PostMapping
	public ResponseEntity<?> createUser(@Valid @RequestBody CreateUserRequest request) {
		try {
			return ResponseEntity.status(HttpStatus.CREATED).body(userService.createUser(request));
		} catch (IllegalArgumentException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	@PutMapping("/{id}")
	public ResponseEntity<?> updateUser(@PathVariable Long id,
			@Valid @RequestBody UpdateUserRequest request) {
		try {
			return ResponseEntity.ok(userService.updateUser(id, request));
		} catch (IllegalArgumentException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	@DeleteMapping("/{id}")
	public ResponseEntity<Void> delete(@PathVariable Long id) {
		userService.delete(id);
		return ResponseEntity.noContent().build();
	}
}
