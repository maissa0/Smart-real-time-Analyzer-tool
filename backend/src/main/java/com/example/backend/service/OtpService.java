package com.example.backend.service;

import com.example.backend.entity.OtpCodeEntity;
import com.example.backend.repository.OtpCodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.UUID;

/**
 * Service for OTP generation and verification (forgot-password flow).
 * OTPs expire after 5 minutes.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OtpService {

    private static final int OTP_LENGTH = 6;
    private static final int OTP_EXPIRY_MINUTES = 5;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final OtpCodeRepository otpCodeRepository;
    private final EmailService emailService;

    /**
     * Generate a 6-digit OTP, store it linked to email with 5-minute expiry.
     * Sends HTML email with the code.
     */
    @Transactional
    public void createAndSendOtp(String email) {
        String code = generateOtp();
        Instant expiresAt = Instant.now().plusSeconds(OTP_EXPIRY_MINUTES * 60L);

        OtpCodeEntity entity = OtpCodeEntity.builder()
                .id(UUID.randomUUID())
                .email(email)
                .code(code)
                .expiresAt(expiresAt)
                .createdAt(Instant.now())
                .build();
        otpCodeRepository.save(entity);

        try {
            emailService.sendForgotPasswordOtp(email, code);
        } catch (Exception e) {
            log.warn("Failed to send OTP email to {}: {} (OTP: {})", email, e.getMessage(), code);
        }
    }

    /**
     * Verify OTP. If valid, mark as used and return true.
     */
    @Transactional
    public boolean verifyAndConsume(String email, String code) {
        Instant now = Instant.now();
        var opt = otpCodeRepository.findByEmailAndCodeAndUsedAtIsNullAndExpiresAtAfter(email, code, now);
        if (opt.isEmpty()) {
            return false;
        }
        OtpCodeEntity entity = opt.get();
        entity.setUsedAt(now);
        otpCodeRepository.save(entity);
        return true;
    }

    private String generateOtp() {
        StringBuilder sb = new StringBuilder(OTP_LENGTH);
        for (int i = 0; i < OTP_LENGTH; i++) {
            sb.append(RANDOM.nextInt(10));
        }
        return sb.toString();
    }

    @Scheduled(cron = "0 */10 * * * *") // Every 10 minutes
    @Transactional
    public void cleanupExpiredOtps() {
        otpCodeRepository.deleteByExpiresAtBefore(Instant.now());
    }
}
