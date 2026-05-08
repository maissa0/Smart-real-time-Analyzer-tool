package com.example.backend.service;

import com.example.backend.entity.MfaRecoveryCodeEntity;
import com.example.backend.entity.UserEntity;
import com.example.backend.repository.MfaRecoveryCodeRepository;
import com.example.backend.repository.UserRepository;
import com.warrenstrange.googleauth.GoogleAuthenticator;
import com.warrenstrange.googleauth.GoogleAuthenticatorKey;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

/**
 * TOTP (Time-based One-Time Password) service for MFA.
 * Generates secrets and QR code URLs compatible with Google Authenticator.
 * Supports backup recovery codes.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MfaTotpService {

    private static final int BACKUP_CODE_COUNT = 10;
    private static final int BACKUP_CODE_LENGTH = 8;
    private static final String BACKUP_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars

    @Value("${app.mfa.issuer:AbleProIAM}")
    private String issuer;

    private final UserRepository userRepository;
    private final MfaRecoveryCodeRepository mfaRecoveryCodeRepository;
    private final PasswordEncoder passwordEncoder;
    private final GoogleAuthenticator googleAuthenticator = new GoogleAuthenticator();

    /**
     * Generate a new TOTP secret for the user. Store it temporarily (not yet enabled).
     * Returns secret and QR code URL for the user to scan with Google Authenticator.
     */
    @Transactional
    public MfaEnableResponse enableMfa(UUID userId) {
        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        if (Boolean.TRUE.equals(user.getMfaEnabled())) {
            throw new IllegalArgumentException("MFA is already enabled");
        }

        GoogleAuthenticatorKey key = googleAuthenticator.createCredentials();
        String secret = key.getKey();
        String qrCodeUrl = buildQrCodeUrl(user.getEmail(), secret);

        // Store secret temporarily - will be confirmed on /mfa/confirm
        user.setMfaSecret(secret);
        userRepository.save(user);

        return new MfaEnableResponse(secret, qrCodeUrl);
    }

    /**
     * Verify the first TOTP code from the user's authenticator app.
     * If valid, set mfa_enabled = true and generate 10 one-time backup recovery codes.
     */
    @Transactional
    public MfaConfirmResponse confirmMfa(UUID userId, int code) {
        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        String secret = user.getMfaSecret();
        if (secret == null || secret.isBlank()) {
            throw new IllegalArgumentException("MFA setup not started. Call /mfa/enable first.");
        }
        if (Boolean.TRUE.equals(user.getMfaEnabled())) {
            throw new IllegalArgumentException("MFA is already enabled");
        }

        boolean valid = googleAuthenticator.authorize(secret, code);
        if (!valid) {
            throw new IllegalArgumentException("Invalid verification code");
        }

        user.setMfaEnabled(true);
        userRepository.save(user);

        List<String> backupCodes = generateAndStoreBackupCodes(userId);
        return new MfaConfirmResponse(backupCodes);
    }

    /**
     * Disable MFA. Requires current password verification.
     */
    @Transactional
    public void disableMfa(UUID userId, String password) {
        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        if (!Boolean.TRUE.equals(user.getMfaEnabled())) {
            throw new IllegalArgumentException("MFA is not enabled");
        }
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new IllegalArgumentException("Invalid password");
        }
        user.setMfaEnabled(false);
        user.setMfaSecret(null);
        userRepository.save(user);
        mfaRecoveryCodeRepository.deleteByUserId(userId);
    }

    /**
     * Verify a backup recovery code. If valid, consume it and return true.
     */
    @Transactional
    public boolean verifyAndConsumeRecoveryCode(UUID userId, String code) {
        String codeHash = hashRecoveryCode(code);
        var opt = mfaRecoveryCodeRepository.findByUserIdAndCodeHashAndUsedAtIsNull(userId, codeHash);
        if (opt.isEmpty()) return false;
        MfaRecoveryCodeEntity entity = opt.get();
        entity.setUsedAt(java.time.Instant.now());
        mfaRecoveryCodeRepository.save(entity);
        return true;
    }

    private List<String> generateAndStoreBackupCodes(UUID userId) {
        SecureRandom random = new SecureRandom();
        List<String> codes = new java.util.ArrayList<>();
        for (int i = 0; i < BACKUP_CODE_COUNT; i++) {
            String code = generateBackupCode(random);
            codes.add(code);
            MfaRecoveryCodeEntity entity = MfaRecoveryCodeEntity.builder()
                    .userId(userId)
                    .codeHash(hashRecoveryCode(code))
                    .build();
            mfaRecoveryCodeRepository.save(entity);
        }
        return codes;
    }

    private String generateBackupCode(SecureRandom random) {
        StringBuilder sb = new StringBuilder(BACKUP_CODE_LENGTH);
        for (int i = 0; i < BACKUP_CODE_LENGTH; i++) {
            sb.append(BACKUP_CODE_CHARS.charAt(random.nextInt(BACKUP_CODE_CHARS.length())));
        }
        return sb.toString();
    }

    private String hashRecoveryCode(String code) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(code.toUpperCase().trim().getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    public record MfaConfirmResponse(List<String> backupCodes) {}

    /**
     * Build otpauth URL (Google Authenticator format) for QR code generation.
     * Format: otpauth://totp/Issuer:user@email?secret=SECRET&issuer=Issuer
     */
    private String buildQrCodeUrl(String accountName, String secret) {
        String label = issuer + ":" + accountName;
        return "otpauth://totp/" + URLEncoder.encode(label, StandardCharsets.UTF_8)
                + "?secret=" + secret + "&issuer=" + URLEncoder.encode(issuer, StandardCharsets.UTF_8);
    }

    public boolean verifyCode(String secret, int code) {
        return googleAuthenticator.authorize(secret, code);
    }

    public record MfaEnableResponse(String secret, String qrCodeUrl) {}
}
