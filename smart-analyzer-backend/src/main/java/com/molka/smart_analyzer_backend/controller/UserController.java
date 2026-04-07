package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.dto.AuthResponse;
import com.molka.smart_analyzer_backend.dto.LoginRequest;
import com.molka.smart_analyzer_backend.dto.RegisterRequest;
import com.molka.smart_analyzer_backend.dto.UserResponse;
import com.molka.smart_analyzer_backend.exception.AuthFailureException;
import com.molka.smart_analyzer_backend.service.UserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserController {

	private final UserService userService;

	public UserController(UserService userService) {
		this.userService = userService;
	}

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

	@GetMapping
	public ResponseEntity<List<UserResponse>> getAll() {
		return ResponseEntity.ok(userService.getAll());
	}

	@DeleteMapping("/{id}")
	public ResponseEntity<Void> delete(@PathVariable Long id) {
		userService.delete(id);
		return ResponseEntity.noContent().build();
	}
}
