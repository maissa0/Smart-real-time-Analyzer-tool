package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.dto.*;
import com.molka.smart_analyzer_backend.exception.AuthFailureException;
import com.molka.smart_analyzer_backend.service.AuditLogService;
import com.molka.smart_analyzer_backend.service.SessionService;
import com.molka.smart_analyzer_backend.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
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
import java.util.Objects;

@RestController
@RequestMapping("/api/users")
public class UserController {

	private final UserService     userService;
	private final SessionService  sessionService;
	private final AuditLogService auditLogService;

	public UserController(UserService userService, SessionService sessionService, AuditLogService auditLogService) {
		this.userService     = userService;
		this.sessionService  = sessionService;
		this.auditLogService = auditLogService;
	}

	// ── Auth ──────────────────────────────────────────────────────────────────

	@PostMapping("/register")
	public ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterRequest request) {
		return ResponseEntity.status(HttpStatus.CREATED).body(userService.register(request));
	}

	@PostMapping("/login")
	public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
		try {
			AuthResponse res = userService.login(request);
			if (res.accessToken() != null && res.userId() != null) {
				sessionService.createSession(res.userId(), res.accessToken(), httpRequest);
				auditLogService.log(res.userId(), res.username(), "LOGIN", "AUTH", null, null, httpRequest);
			}
			return ResponseEntity.ok(res);
		} catch (AuthFailureException ex) {
			return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("message", ex.getMessage()));
		}
	}

	// ── Forgot / Reset password ───────────────────────────────────────────────

	@PostMapping("/forgot-password")
	public ResponseEntity<?> forgotPassword(@Valid @RequestBody com.molka.smart_analyzer_backend.dto.ForgotPasswordRequest request) {
		userService.forgotPassword(request.email());
		return ResponseEntity.ok(Map.of("message", "If that email is registered, you will receive a reset code shortly."));
	}

	@PostMapping("/reset-password")
	public ResponseEntity<?> resetPassword(@Valid @RequestBody com.molka.smart_analyzer_backend.dto.ResetPasswordRequest request,
			HttpServletRequest httpRequest) {
		try {
			userService.resetPassword(request.email(), request.otp(), request.newPassword());
			auditLogService.log(null, request.email(), "PASSWORD_RESET", "AUTH", null, null, httpRequest);
			return ResponseEntity.ok(Map.of("message", "Password reset successfully."));
		} catch (com.molka.smart_analyzer_backend.exception.AuthFailureException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	// ── MFA: complete login with TOTP code ────────────────────────────────────

	@PostMapping("/login/mfa")
	public ResponseEntity<?> loginMfa(@RequestBody Map<String, Object> body, HttpServletRequest httpRequest) {
		try {
			String mfaToken = Objects.toString(body.get("mfaToken"), "");
			int code = Integer.parseInt(Objects.toString(body.get("code"), "0"));
			AuthResponse res = userService.verifyMfaLogin(mfaToken, code);
			if (res.accessToken() != null && res.userId() != null) {
				sessionService.createSession(res.userId(), res.accessToken(), httpRequest);
				auditLogService.log(res.userId(), res.username(), "LOGIN_MFA", "AUTH", null, null, httpRequest);
			}
			return ResponseEntity.ok(res);
		} catch (AuthFailureException ex) {
			return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("message", ex.getMessage()));
		} catch (Exception ex) {
			return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("message", "Invalid MFA code."));
		}
	}

	@PostMapping("/logout")
	public ResponseEntity<?> logout(Authentication auth, HttpServletRequest httpRequest) {
		if (auth != null) {
			try {
				UserResponse me = userService.getMe(auth.getName());
				String header = httpRequest.getHeader("Authorization");
				if (header != null && header.startsWith("Bearer ")) {
					String token = header.substring(7).trim();
					// Revoke the current session
					sessionService.getSessions(me.id(), token).stream()
							.filter(com.molka.smart_analyzer_backend.dto.SessionResponse::isCurrent)
							.findFirst()
							.ifPresent(s -> { try { sessionService.revokeSession(s.id(), me.id()); } catch (Exception ignored) {} });
				}
				auditLogService.log(me.id(), me.username(), "LOGOUT", "AUTH", null, null, httpRequest);
			} catch (Exception ignored) {}
		}
		return ResponseEntity.ok(Map.of("message", "Logged out."));
	}

	// ── MFA: setup — generate secret + QR URL ────────────────────────────────

	@GetMapping("/mfa/setup")
	public ResponseEntity<?> mfaSetup(Authentication auth) {
		return ResponseEntity.ok(userService.setupMfa(auth.getName()));
	}

	// ── MFA: enable — confirm code ────────────────────────────────────────────

	@PostMapping("/mfa/enable")
	public ResponseEntity<?> mfaEnable(@RequestBody Map<String, Object> body, Authentication auth,
			HttpServletRequest httpRequest) {
		try {
			int code = Integer.parseInt(Objects.toString(body.get("code"), "0"));
			userService.enableMfa(auth.getName(), code);
			UserResponse me = userService.getMe(auth.getName());
			auditLogService.log(me.id(), me.username(), "MFA_ENABLED", "SECURITY", null, null, httpRequest);
			return ResponseEntity.ok(Map.of("mfaEnabled", true));
		} catch (IllegalArgumentException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	// ── MFA: disable — verify password + code ────────────────────────────────

	@PostMapping("/mfa/disable")
	public ResponseEntity<?> mfaDisable(@RequestBody Map<String, Object> body, Authentication auth,
			HttpServletRequest httpRequest) {
		try {
			String password = Objects.toString(body.get("password"), "");
			int code = Integer.parseInt(Objects.toString(body.get("code"), "0"));
			userService.disableMfa(auth.getName(), password, code);
			UserResponse me = userService.getMe(auth.getName());
			auditLogService.log(me.id(), me.username(), "MFA_DISABLED", "SECURITY", null, null, httpRequest);
			return ResponseEntity.ok(Map.of("mfaEnabled", false));
		} catch (AuthFailureException ex) {
			return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("message", ex.getMessage()));
		} catch (IllegalArgumentException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	// ── Self ──────────────────────────────────────────────────────────────────

	@GetMapping("/me")
	public ResponseEntity<UserResponse> getMe(Authentication auth) {
		return ResponseEntity.ok(userService.getMe(auth.getName()));
	}

	@PutMapping("/me")
	public ResponseEntity<?> updateMe(@Valid @RequestBody UpdateMeRequest request, Authentication auth,
			HttpServletRequest httpRequest) {
		try {
			UserResponse updated = userService.updateMe(auth.getName(), request);
			if (request.newPassword() != null && !request.newPassword().isBlank()) {
				auditLogService.log(updated.id(), updated.username(), "PASSWORD_CHANGED", "AUTH", null, null, httpRequest);
			}
			return ResponseEntity.ok(updated);
		} catch (com.molka.smart_analyzer_backend.exception.AuthFailureException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
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
	public ResponseEntity<?> createUser(@Valid @RequestBody CreateUserRequest request,
			Authentication auth, HttpServletRequest httpRequest) {
		try {
			UserResponse created = userService.createUser(request);
			UserResponse admin = userService.getMe(auth.getName());
			auditLogService.log(admin.id(), admin.username(), "USER_CREATED", "USER",
					String.valueOf(created.id()), "{\"username\":\"" + created.username() + "\"}", httpRequest);
			return ResponseEntity.status(HttpStatus.CREATED).body(created);
		} catch (IllegalArgumentException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	@PutMapping("/{id}")
	public ResponseEntity<?> updateUser(@PathVariable Long id,
			@Valid @RequestBody UpdateUserRequest request,
			Authentication auth, HttpServletRequest httpRequest) {
		try {
			UserResponse updated = userService.updateUser(id, request);
			UserResponse admin = userService.getMe(auth.getName());
			auditLogService.log(admin.id(), admin.username(), "USER_UPDATED", "USER",
					String.valueOf(id), "{\"username\":\"" + updated.username() + "\"}", httpRequest);
			return ResponseEntity.ok(updated);
		} catch (IllegalArgumentException ex) {
			return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
		}
	}

	@DeleteMapping("/{id}")
	public ResponseEntity<Void> delete(@PathVariable Long id,
			Authentication auth, HttpServletRequest httpRequest) {
		UserResponse admin = userService.getMe(auth.getName());
		userService.delete(id);
		auditLogService.log(admin.id(), admin.username(), "USER_DELETED", "USER",
				String.valueOf(id), null, httpRequest);
		return ResponseEntity.noContent().build();
	}
}
