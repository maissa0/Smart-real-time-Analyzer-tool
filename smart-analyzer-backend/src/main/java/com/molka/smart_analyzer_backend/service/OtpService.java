package com.molka.smart_analyzer_backend.service;

import com.molka.smart_analyzer_backend.entity.OtpEntity;
import com.molka.smart_analyzer_backend.repository.OtpRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;

@Service
@RequiredArgsConstructor
@Slf4j
public class OtpService {

    private static final int OTP_LENGTH = 6;
    private static final SecureRandom RANDOM = new SecureRandom();

    @Value("${otp.expiry.minutes:15}")
    private int expiryMinutes;

    private final OtpRepository otpRepository;
    private final EmailService emailService;

    /** Generate a 6-digit OTP, persist it, and send it to the given email. */
    @Transactional
    public void generateOtp(String email) {
        String code = generateCode();
        Instant expiresAt = Instant.now().plusSeconds(expiryMinutes * 60L);

        OtpEntity entity = OtpEntity.builder()
                .email(email)
                .code(code)
                .expiresAt(expiresAt)
                .used(false)
                .build();
        otpRepository.save(entity);

        try {
            emailService.sendForgotPasswordOtp(email, code);
        } catch (Exception e) {
            log.warn("OTP email send failed for {}: {} — OTP still stored.", email, e.getMessage());
        }
    }

    /** Validate OTP and mark it as used. Returns true if valid. */
    @Transactional
    public boolean verifyOtp(String email, String code) {
        var opt = otpRepository
                .findTopByEmailAndCodeAndUsedFalseAndExpiresAtAfterOrderByCreatedAtDesc(
                        email, code, Instant.now());
        if (opt.isEmpty()) return false;
        OtpEntity entity = opt.get();
        entity.setUsed(true);
        otpRepository.save(entity);
        return true;
    }

    /** Purge expired OTPs every 10 minutes. */
    @Scheduled(cron = "0 */10 * * * *")
    @Transactional
    public void cleanupExpiredOtps() {
        otpRepository.deleteByExpiresAtBefore(Instant.now());
    }

    private String generateCode() {
        StringBuilder sb = new StringBuilder(OTP_LENGTH);
        for (int i = 0; i < OTP_LENGTH; i++) sb.append(RANDOM.nextInt(10));
        return sb.toString();
    }
}
