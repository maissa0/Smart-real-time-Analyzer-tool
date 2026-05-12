package com.example.backend.service;

import com.example.backend.dto.auth.*;
import com.example.backend.entity.RefreshTokenEntity;
import com.example.backend.entity.RoleEntity;
import com.example.backend.entity.SessionEntity;
import com.example.backend.entity.UserEntity;
import com.example.backend.mapper.UserMapper;
import com.example.backend.repository.RefreshTokenRepository;
import com.example.backend.repository.RoleRepository;
import com.example.backend.repository.SessionRepository;
import com.example.backend.repository.UserRepository;
import com.example.backend.security.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final SessionRepository sessionRepository;
    private final OtpService otpService;
    private final MfaTotpService mfaTotpService;
    private final EmailService emailService;
    private final UserMapper userMapper;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;
    private final RoleRepository roleRepository;
    private final AuthenticationManager authenticationManager;
    private final AuditService auditService;

    /**
     * Login. If user has MFA enabled, returns 202 with mfaToken instead of full tokens.
     */
    @Transactional
    public Object login(LoginRequest request, HttpServletRequest httpRequest) {
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(request.getEmail(), request.getPassword())
        );

        UserEntity user = userRepository.findByEmailAndDeletedAtIsNull(request.getEmail())
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (Boolean.TRUE.equals(user.getMfaEnabled())) {
            String mfaToken = jwtService.generateMfaAuthToken(user.getEmail(), user.getId());
            auditService.logSecurity("LOGIN_MFA_REQUIRED", "auth", user.getId().toString(),
                    user.getId(), null, httpRequest);
            return MfaAuthResponse.builder()
                    .mfaRequired(true)
                    .mfaToken(mfaToken)
                    .build();
        }

        return completeLogin(user, httpRequest);
    }

    /**
     * Verify MFA code and return full auth tokens.
     */
    @Transactional
    public AuthResponse verifyMfa(MfaVerifyRequest request, HttpServletRequest httpRequest) {
        if (!jwtService.isTokenValid(request.getMfaToken()) || !jwtService.isMfaAuthToken(request.getMfaToken())) {
            throw new IllegalArgumentException("Invalid or expired MFA token");
        }
        String email = jwtService.getEmailFromToken(request.getMfaToken());
        UUID userId = jwtService.getUserIdFromToken(request.getMfaToken());
        UserEntity user = userRepository.findById(userId)
                .filter(u -> email.equals(u.getEmail()))
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        String codeInput = request.getCode();
        boolean valid = false;
        if (codeInput != null && codeInput.length() == 6 && codeInput.matches("\\d{6}")) {
            valid = mfaTotpService.verifyCode(user.getMfaSecret(), Integer.parseInt(codeInput));
        } else if (codeInput != null && codeInput.length() == 8 && codeInput.matches("[A-Za-z0-9]+")) {
            valid = mfaTotpService.verifyAndConsumeRecoveryCode(user.getId(), codeInput);
        }
        if (!valid) {
            throw new IllegalArgumentException("Invalid verification code");
        }

        auditService.logSecurity("LOGIN_SUCCESS", "auth", user.getId().toString(),
                user.getId(), java.util.Map.of("mfa", true), httpRequest);

        return completeLogin(user, httpRequest);
    }

    private AuthResponse completeLogin(UserEntity user, HttpServletRequest httpRequest) {
        SessionEntity session = createSession(user.getId(), httpRequest);
        String accessToken = jwtService.generateAccessToken(user.getEmail(), user.getId(), session.getId());
        String refreshToken = jwtService.generateRefreshToken(user.getEmail(), user.getId());
        storeRefreshToken(user.getId(), refreshToken, session.getId(), httpRequest);
        return buildAuthResponse(user, accessToken, refreshToken);
    }

    @Transactional
    public AuthResponse register(RegisterRequest request, HttpServletRequest httpRequest) {
        if (userRepository.existsByEmailAndDeletedAtIsNull(request.getEmail())) {
            throw new IllegalArgumentException("Email already registered");
        }
        String username = request.getEmail().split("@")[0];
        if (userRepository.existsByUsernameAndDeletedAtIsNull(username)) {
            username = username + "_" + System.currentTimeMillis() % 10000;
        }

        RoleEntity defaultRole = roleRepository.findByName("User").orElse(null);

        UserEntity user = UserEntity.builder()
                .email(request.getEmail())
                .username(username)
                .passwordHash(passwordEncoder.encode(request.getPassword()))
                .fullName(request.getName())
                .isActive(false)
                .mfaEnabled(false)
                .verified(false)
                .status("PENDING")
                .build();
        if (defaultRole != null) {
            user.setRoles(new java.util.HashSet<>(java.util.List.of(defaultRole)));
        }

        user = userRepository.save(user);
        auditService.logSecurity("USER_REGISTER_PENDING", "auth", user.getId().toString(),
                user.getId(), null, httpRequest);
        try {
            emailService.sendRegistrationPendingEmail(user.getEmail(), user.getFullName());
        } catch (Exception e) {
            // Log but don't fail registration
        }
        return AuthResponse.builder()
                .message("Registration successful. Your account is pending admin approval. You will receive an email once approved.")
                .build();
    }

    @Transactional
    public AuthResponse refresh(RefreshTokenRequest request, HttpServletRequest httpRequest) {
        String tokenHash = hashToken(request.getRefreshToken());
        Instant now = Instant.now();

        RefreshTokenEntity stored = refreshTokenRepository
                .findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(tokenHash, now)
                .orElseThrow(() -> new RuntimeException("Invalid or expired refresh token"));

        UserEntity user = userRepository.findById(stored.getUserId())
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (!Boolean.TRUE.equals(user.getIsActive())) {
            throw new org.springframework.security.authentication.DisabledException("Account Disabled");
        }

        // Revoke old token (rotation)
        stored.setRevokedAt(now);
        refreshTokenRepository.save(stored);

        // Reuse existing session, update last_active
        UUID sessionId = stored.getSessionId();
        if (sessionId != null) {
            String ua = truncate(httpRequest.getHeader("User-Agent"), 500);
            sessionRepository.findById(sessionId).ifPresent(s -> {
                s.setLastActive(now);
                s.setIpAddress(getClientIp(httpRequest));
                s.setUserAgent(ua);
                s.setDevice(ua);
                sessionRepository.save(s);
            });
        } else {
            SessionEntity session = createSession(user.getId(), httpRequest);
            sessionId = session.getId();
        }
        String newAccessToken = jwtService.generateAccessToken(user.getEmail(), user.getId(), sessionId);
        String newRefreshToken = jwtService.generateRefreshToken(user.getEmail(), user.getId());
        storeRefreshToken(user.getId(), newRefreshToken, sessionId, httpRequest);

        auditService.logSecurity("TOKEN_REFRESH", "auth", user.getId().toString(),
                user.getId(), null, httpRequest);

        return buildAuthResponse(user, newAccessToken, newRefreshToken);
    }

    /**
     * Forgot password: generate 6-digit OTP, store in otp_codes (5-min expiry), log to console.
     */
    public void forgotPassword(ForgotPasswordRequest request, HttpServletRequest httpRequest) {
        var user = userRepository.findByEmailAndDeletedAtIsNull(request.getEmail());
        if (user.isPresent()) {
            otpService.createAndSendOtp(request.getEmail());
            auditService.logSecurity("PASSWORD_RESET_REQUEST", "auth", request.getEmail(), user.get().getId(), null, httpRequest);
        }
        // Always return success to prevent email enumeration
    }

    /**
     * Verify OTP. If valid, return a temporary reset token (15-min expiry).
     */
    public VerifyOtpResponse verifyOtp(VerifyOtpRequest request, HttpServletRequest httpRequest) {
        if (!otpService.verifyAndConsume(request.getEmail(), request.getCode())) {
            throw new IllegalArgumentException("Invalid or expired OTP");
        }
        UserEntity user = userRepository.findByEmailAndDeletedAtIsNull(request.getEmail())
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        auditService.logSecurity("OTP_VERIFIED", "auth", user.getId().toString(), user.getId(),
                java.util.Map.of("email", request.getEmail()), httpRequest);
        String resetToken = jwtService.generateResetToken(user.getEmail(), user.getId());
        return VerifyOtpResponse.builder()
                .resetToken(resetToken)
                .expiresInSeconds(jwtService.getResetTokenExpirationSeconds())
                .build();
    }

    /**
     * Reset password using the token from verify-otp.
     */
    @Transactional
    public void resetPassword(ResetPasswordRequest request, HttpServletRequest httpRequest) {
        if (!jwtService.isTokenValid(request.getResetToken()) || !jwtService.isResetToken(request.getResetToken())) {
            throw new IllegalArgumentException("Invalid or expired reset token");
        }
        String email = jwtService.getEmailFromToken(request.getResetToken());
        UUID userId = jwtService.getUserIdFromToken(request.getResetToken());
        UserEntity user = userRepository.findById(userId)
                .filter(u -> email.equals(u.getEmail()))
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setPasswordHash(passwordEncoder.encode(request.getNewPassword()));
        userRepository.save(user);
        auditService.logSecurity("PASSWORD_RESET", "auth", user.getId().toString(), user.getId(), null, httpRequest);
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    private SessionEntity createSession(UUID userId, HttpServletRequest request) {
        String ip = getClientIp(request);
        String ua = truncate(request.getHeader("User-Agent"), 500);
        SessionEntity session = SessionEntity.builder()
                .userId(userId)
                .ipAddress(ip)
                .userAgent(ua)
                .device(ua)
                .build();
        return sessionRepository.save(session);
    }

    private void storeRefreshToken(UUID userId, String token, UUID sessionId, HttpServletRequest request) {
        String tokenHash = hashToken(token);
        Instant expiresAt = Instant.now().plusSeconds(604800); // 7 days

        RefreshTokenEntity entity = RefreshTokenEntity.builder()
                .userId(userId)
                .sessionId(sessionId)
                .tokenHash(tokenHash)
                .device(request != null ? request.getHeader("User-Agent") : null)
                .ipAddress(request != null ? getClientIp(request) : null)
                .userAgent(request != null ? request.getHeader("User-Agent") : null)
                .expiresAt(expiresAt)
                .build();
        refreshTokenRepository.save(entity);
    }

    private String hashToken(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    private String getClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private AuthResponse buildAuthResponse(UserEntity user, String accessToken, String refreshToken) {
        var userResponse = userMapper.toResponse(user);
        var permissions = user.getRoles().stream()
                .flatMap(r -> r.getPermissions().stream())
                .distinct()
                .map(p -> AuthResponse.PermissionDto.builder()
                        .id(p.getId().toString())
                        .slug(p.getSlug())
                        .description(p.getDescription())
                        .build())
                .collect(Collectors.toList());

        return AuthResponse.builder()
                .user(userResponse)
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .tokenType("Bearer")
                .expiresIn(jwtService.getAccessTokenExpirationSeconds())
                .permissions(permissions)
                .build();
    }
}
