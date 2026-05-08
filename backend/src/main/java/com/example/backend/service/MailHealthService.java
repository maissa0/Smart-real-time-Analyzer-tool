package com.example.backend.service;

import com.example.backend.entity.UserEntity;
import com.example.backend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class MailHealthService {

    private final EmailService emailService;
    private final UserRepository userRepository;

    /**
     * Send a test email to the admin to verify SMTP connection.
     * Called synchronously (not async) so we can report success/failure immediately.
     */
    public Map<String, String> sendTestEmail(UUID adminUserId) {
        UserEntity admin = userRepository.findById(adminUserId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        String toEmail = admin.getEmail();
        try {
            emailService.sendTestEmailSync(toEmail);
            return Map.of("status", "OK", "message", "Test email sent successfully to " + toEmail);
        } catch (Exception e) {
            log.error("Mail health check failed: {}", e.getMessage());
            return Map.of("status", "ERROR", "message", "Failed to send test email: " + e.getMessage());
        }
    }
}
