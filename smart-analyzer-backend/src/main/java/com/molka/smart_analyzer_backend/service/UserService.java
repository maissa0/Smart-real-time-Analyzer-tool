package com.molka.smart_analyzer_backend.service;

import com.molka.smart_analyzer_backend.dto.AuthResponse;
import com.molka.smart_analyzer_backend.dto.LoginRequest;
import com.molka.smart_analyzer_backend.dto.RegisterRequest;
import com.molka.smart_analyzer_backend.dto.UserResponse;
import com.molka.smart_analyzer_backend.entity.Role;
import com.molka.smart_analyzer_backend.entity.User;
import com.molka.smart_analyzer_backend.exception.AuthFailureException;
import com.molka.smart_analyzer_backend.repository.UserRepository;
import com.molka.smart_analyzer_backend.security.JwtTokenProvider;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class UserService {

	private final UserRepository userRepository;
	private final PasswordEncoder passwordEncoder;
	private final AuthenticationManager authenticationManager;
	private final JwtTokenProvider jwtTokenProvider;

	public UserService(
			UserRepository userRepository,
			PasswordEncoder passwordEncoder,
			AuthenticationManager authenticationManager,
			JwtTokenProvider jwtTokenProvider) {
		this.userRepository = userRepository;
		this.passwordEncoder = passwordEncoder;
		this.authenticationManager = authenticationManager;
		this.jwtTokenProvider = jwtTokenProvider;
	}

	@Transactional
	public UserResponse register(RegisterRequest request) {
		if (userRepository.existsByUsername(request.username())) {
			throw new IllegalArgumentException("Username already taken");
		}
		if (userRepository.existsByEmail(request.email())) {
			throw new IllegalArgumentException("Email already registered");
		}
		User user = User.builder()
				.username(request.username())
				.email(request.email())
				.password(passwordEncoder.encode(request.password()))
				.role(Role.USER)
				.build();
		User saved = userRepository.save(user);
		return toResponse(saved);
	}

	public AuthResponse login(LoginRequest request) {
		String identifier = request.username() == null ? "" : request.username().trim();
		boolean loginByEmail = identifier.contains("@");

		User user = (loginByEmail ? userRepository.findByEmail(identifier) : userRepository.findByUsername(identifier))
				.orElseThrow(() -> new AuthFailureException("No account found with this email."));

		if (!passwordEncoder.matches(request.password(), user.getPassword())) {
			throw new AuthFailureException("Incorrect password. Please try again.");
		}

		try {
			Authentication authentication = authenticationManager.authenticate(
					new UsernamePasswordAuthenticationToken(user.getUsername(), request.password()));
			UserDetails userDetails = (UserDetails) authentication.getPrincipal();
			String token = jwtTokenProvider.generateToken(userDetails);
			return new AuthResponse(token);
		} catch (DisabledException | LockedException ex) {
			throw new AuthFailureException("Your account has been disabled.");
		} catch (AuthenticationException ex) {
			throw new AuthFailureException("Login failed. Please check your credentials.");
		}
	}

	@Transactional(readOnly = true)
	public List<UserResponse> getAll() {
		return userRepository.findAll().stream().map(this::toResponse).toList();
	}

	@Transactional
	public void delete(Long id) {
		if (!userRepository.existsById(id)) {
			throw new IllegalArgumentException("User not found: " + id);
		}
		userRepository.deleteById(id);
	}

	private UserResponse toResponse(User user) {
		return new UserResponse(user.getId(), user.getUsername(), user.getEmail(), user.getRole(), user.getCreatedAt());
	}
}
