package com.molka.smart_analyzer_backend.service;

import com.molka.smart_analyzer_backend.dto.*;
import com.molka.smart_analyzer_backend.entity.Role;
import com.molka.smart_analyzer_backend.entity.User;
import com.molka.smart_analyzer_backend.exception.AuthFailureException;
import com.molka.smart_analyzer_backend.repository.UserRepository;
import com.molka.smart_analyzer_backend.security.CustomUserDetailsService;
import com.molka.smart_analyzer_backend.security.JwtTokenProvider;
import com.molka.smart_analyzer_backend.service.OtpService;
import com.molka.smart_analyzer_backend.storage.StorageService;
import org.springframework.beans.factory.annotation.Value;
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
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;

@Service
public class UserService {

	private final UserRepository userRepository;
	private final PasswordEncoder passwordEncoder;
	private final AuthenticationManager authenticationManager;
	private final JwtTokenProvider jwtTokenProvider;
	private final MfaService mfaService;
	private final CustomUserDetailsService userDetailsService;
	private final StorageService storageService;
	private final OtpService otpService;

	@Value("${avatars.upload-dir:uploads/avatars}")
	private String avatarsUploadDir;

	public UserService(
			UserRepository userRepository,
			PasswordEncoder passwordEncoder,
			AuthenticationManager authenticationManager,
			JwtTokenProvider jwtTokenProvider,
			MfaService mfaService,
			CustomUserDetailsService userDetailsService,
			StorageService storageService,
			OtpService otpService) {
		this.userRepository = userRepository;
		this.passwordEncoder = passwordEncoder;
		this.authenticationManager = authenticationManager;
		this.jwtTokenProvider = jwtTokenProvider;
		this.mfaService = mfaService;
		this.userDetailsService = userDetailsService;
		this.storageService = storageService;
		this.otpService = otpService;
	}

	// ── Register ──────────────────────────────────────────────────────────────

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
		return toResponse(userRepository.save(user));
	}

	// ── Login ─────────────────────────────────────────────────────────────────

	public AuthResponse login(LoginRequest request) {
		String identifier = request.username() == null ? "" : request.username().trim();
		boolean loginByEmail = identifier.contains("@");

		User user = (loginByEmail
				? userRepository.findByEmail(identifier)
				: userRepository.findByUsername(identifier))
				.orElseThrow(() -> new AuthFailureException("No account found with this identifier."));

		if (!passwordEncoder.matches(request.password(), user.getPassword())) {
			throw new AuthFailureException("Incorrect password. Please try again.");
		}

		try {
			Authentication authentication = authenticationManager.authenticate(
					new UsernamePasswordAuthenticationToken(user.getUsername(), request.password()));
			UserDetails userDetails = (UserDetails) authentication.getPrincipal();

			if (user.isMfaEnabled()) {
				String mfaToken = jwtTokenProvider.generateMfaToken(user.getUsername());
				return AuthResponse.mfaChallenge(mfaToken);
			}

			String token = jwtTokenProvider.generateToken(userDetails);
			return new AuthResponse(token, user.getId(), user.getUsername(), user.getEmail(), user.getRole().name());
		} catch (DisabledException | LockedException ex) {
			throw new AuthFailureException("Your account has been disabled.");
		} catch (AuthenticationException ex) {
			throw new AuthFailureException("Login failed. Please check your credentials.");
		}
	}

	// ── MFA: verify login TOTP code ───────────────────────────────────────────

	public AuthResponse verifyMfaLogin(String mfaToken, int code) {
		if (!jwtTokenProvider.isMfaPendingToken(mfaToken)) {
			throw new AuthFailureException("MFA token is invalid or expired.");
		}
		String username = jwtTokenProvider.getUsernameFromToken(mfaToken);
		User user = userRepository.findByUsername(username)
				.orElseThrow(() -> new AuthFailureException("User not found."));
		if (user.getMfaSecret() == null || !mfaService.verifyCode(user.getMfaSecret(), code)) {
			throw new AuthFailureException("Invalid authenticator code.");
		}
		UserDetails userDetails = userDetailsService.loadUserByUsername(username);
		String accessToken = jwtTokenProvider.generateToken(userDetails);
		return new AuthResponse(accessToken, user.getId(), user.getUsername(), user.getEmail(), user.getRole().name());
	}

	// ── MFA: setup (generate secret + QR URL) ────────────────────────────────

	@Transactional
	public Map<String, String> setupMfa(String username) {
		User user = userRepository.findByUsername(username)
				.orElseThrow(() -> new IllegalArgumentException("User not found"));
		String secret = mfaService.generateSecret();
		user.setMfaSecret(secret);
		userRepository.save(user);
		String qrCodeUrl = mfaService.buildQrCodeUrl(user.getEmail(), secret);
		return Map.of("secret", secret, "qrCodeUrl", qrCodeUrl);
	}

	// ── MFA: enable (verify code, set mfaEnabled = true) ─────────────────────

	@Transactional
	public void enableMfa(String username, int code) {
		User user = userRepository.findByUsername(username)
				.orElseThrow(() -> new IllegalArgumentException("User not found"));
		if (user.getMfaSecret() == null) {
			throw new IllegalStateException("MFA setup not started. Call /mfa/setup first.");
		}
		if (!mfaService.verifyCode(user.getMfaSecret(), code)) {
			throw new IllegalArgumentException("Invalid authenticator code.");
		}
		user.setMfaEnabled(true);
		userRepository.save(user);
	}

	// ── MFA: disable (verify password + code, clear MFA) ─────────────────────

	@Transactional
	public void disableMfa(String username, String password, int code) {
		User user = userRepository.findByUsername(username)
				.orElseThrow(() -> new IllegalArgumentException("User not found"));
		if (!passwordEncoder.matches(password, user.getPassword())) {
			throw new AuthFailureException("Incorrect password.");
		}
		if (user.getMfaSecret() == null || !mfaService.verifyCode(user.getMfaSecret(), code)) {
			throw new AuthFailureException("Invalid authenticator code.");
		}
		user.setMfaEnabled(false);
		user.setMfaSecret(null);
		userRepository.save(user);
	}

	// ── Admin: list all users ─────────────────────────────────────────────────

	@Transactional(readOnly = true)
	public List<UserResponse> getAll() {
		return userRepository.findAll().stream().map(this::toResponse).toList();
	}

	// ── Admin: create user ────────────────────────────────────────────────────

	@Transactional
	public UserResponse createUser(CreateUserRequest request) {
		if (userRepository.existsByUsername(request.username())) {
			throw new IllegalArgumentException("Username already taken");
		}
		if (userRepository.existsByEmail(request.email())) {
			throw new IllegalArgumentException("Email already registered");
		}
		Role role = request.role() != null ? request.role() : Role.USER;
		User user = User.builder()
				.username(request.username())
				.email(request.email())
				.password(passwordEncoder.encode(request.password()))
				.role(role)
				.build();
		return toResponse(userRepository.save(user));
	}

	// ── Admin: update user ────────────────────────────────────────────────────

	@Transactional
	public UserResponse updateUser(Long id, UpdateUserRequest request) {
		User user = userRepository.findById(id)
				.orElseThrow(() -> new IllegalArgumentException("User not found: " + id));

		if (!user.getUsername().equals(request.username())
				&& userRepository.existsByUsername(request.username())) {
			throw new IllegalArgumentException("Username already taken");
		}
		if (!user.getEmail().equals(request.email())
				&& userRepository.existsByEmail(request.email())) {
			throw new IllegalArgumentException("Email already registered");
		}

		user.setUsername(request.username());
		user.setEmail(request.email());
		if (request.role() != null) user.setRole(request.role());
		return toResponse(userRepository.save(user));
	}

	// ── Admin: delete user ────────────────────────────────────────────────────

	@Transactional
	public void delete(Long id) {
		if (!userRepository.existsById(id)) {
			throw new IllegalArgumentException("User not found: " + id);
		}
		userRepository.deleteById(id);
	}

	// ── Self: get current user ────────────────────────────────────────────────

	@Transactional(readOnly = true)
	public UserResponse getMe(String username) {
		User user = userRepository.findByUsername(username)
				.orElseThrow(() -> new IllegalArgumentException("User not found"));
		return toResponse(user);
	}

	// ── Self: update own profile ──────────────────────────────────────────────

	@Transactional
	public UserResponse updateMe(String username, UpdateMeRequest request) {
		User user = userRepository.findByUsername(username)
				.orElseThrow(() -> new IllegalArgumentException("User not found"));

		if (!user.getUsername().equals(request.username())
				&& userRepository.existsByUsername(request.username())) {
			throw new IllegalArgumentException("Username already taken");
		}
		if (!user.getEmail().equals(request.email())
				&& userRepository.existsByEmail(request.email())) {
			throw new IllegalArgumentException("Email already registered");
		}

		user.setUsername(request.username());
		user.setEmail(request.email());
		if (request.newPassword() != null && !request.newPassword().isBlank()) {
			if (request.currentPassword() == null || request.currentPassword().isBlank()) {
				throw new AuthFailureException("Current password is required to set a new password.");
			}
			if (!passwordEncoder.matches(request.currentPassword(), user.getPassword())) {
				throw new AuthFailureException("Current password is incorrect.");
			}
			user.setPassword(passwordEncoder.encode(request.newPassword()));
		}
		return toResponse(userRepository.save(user));
	}

	// ── Self: upload avatar ───────────────────────────────────────────────────

	@Transactional
	public UserResponse uploadAvatar(String username, MultipartFile file) throws IOException {
		User user = userRepository.findByUsername(username)
				.orElseThrow(() -> new IllegalArgumentException("User not found"));

		String original    = file.getOriginalFilename();
		String ext         = (original != null && original.contains("."))
				? original.substring(original.lastIndexOf('.')).toLowerCase()
				: ".jpg";
		String objectKey   = "avatars/" + user.getId() + "_" + System.currentTimeMillis() + ext;
		String contentType = file.getContentType() != null ? file.getContentType() : "image/jpeg";

		String address = storageService.store(file.getInputStream(), file.getSize(), objectKey, contentType);
		user.setAvatarPath(address);
		return toResponse(userRepository.save(user));
	}

	// ── Forgot / Reset password ───────────────────────────────────────────────

	@Transactional
	public void forgotPassword(String email) {
		// Silently succeed even if email not found — avoids user enumeration
		if (userRepository.findByEmail(email).isPresent()) {
			otpService.generateOtp(email);
		}
	}

	@Transactional
	public void resetPassword(String email, String otp, String newPassword) {
		if (!otpService.verifyOtp(email, otp)) {
			throw new AuthFailureException("Invalid or expired OTP code.");
		}
		User user = userRepository.findByEmail(email)
				.orElseThrow(() -> new AuthFailureException("No account found with that email."));
		user.setPassword(passwordEncoder.encode(newPassword));
		userRepository.save(user);
	}

	// ── Avatar path resolution (kept for local serving via getAvatar endpoint) ──

	public Path resolveAvatarsDir() {
		Path backendRoot = Paths.get("").toAbsolutePath();
		Path repoRoot    = backendRoot.getParent() != null ? backendRoot.getParent() : backendRoot;
		return repoRoot.resolve(avatarsUploadDir).toAbsolutePath().normalize();
	}

	// ── Mapping ───────────────────────────────────────────────────────────────

	private UserResponse toResponse(User user) {
		String avatarUrl = null;
		if (user.getAvatarPath() != null) {
			avatarUrl = storageService.getPublicUrl(user.getAvatarPath());
		}
		return new UserResponse(
				user.getId(), user.getUsername(), user.getEmail(),
				user.getRole(), user.getCreatedAt(), avatarUrl, user.isMfaEnabled());
	}
}
