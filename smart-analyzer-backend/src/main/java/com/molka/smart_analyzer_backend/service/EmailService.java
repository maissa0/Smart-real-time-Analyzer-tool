package com.molka.smart_analyzer_backend.service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class EmailService {

    private final JavaMailSender mailSender;

    @Value("${spring.mail.username}")
    private String fromEmail;

    @Async
    public void sendForgotPasswordOtp(String toEmail, String otpCode) {
        String subject = "Password Reset — Your Verification Code";
        String html = buildOtpHtml(otpCode);
        sendHtmlEmail(toEmail, subject, html);
    }

    private void sendHtmlEmail(String to, String subject, String html) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(fromEmail, "Smart Analyser");
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(html, true);
            mailSender.send(message);
            log.debug("OTP email sent to {}", to);
        } catch (MessagingException | java.io.UnsupportedEncodingException e) {
            log.error("Failed to send email to {}: {}", to, e.getMessage());
            throw new RuntimeException("Failed to send email", e);
        }
    }

    private String buildOtpHtml(String code) {
        return """
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><style>
              body { font-family: Arial, sans-serif; background: #07090b; color: #c0d0b0; }
              .container { max-width: 500px; margin: 40px auto; padding: 30px;
                           border: 1px solid rgba(176,255,68,0.3); background: rgba(255,255,255,0.03); }
              .code-box { background: #0f1a0a; border: 2px dashed #b0ff44; padding: 20px;
                          text-align: center; font-size: 32px; font-weight: bold;
                          letter-spacing: 10px; color: #b0ff44; margin: 24px 0; }
              .footer { font-size: 12px; color: #666; margin-top: 24px; }
            </style></head>
            <body><div class="container">
              <h2 style="color:#b0ff44">Password Reset Request</h2>
              <p>Use the following code to reset your password. It expires in 15 minutes.</p>
              <div class="code-box">%s</div>
              <p>If you did not request a password reset, you can safely ignore this email.</p>
              <p class="footer">Smart Analyser — Network Intelligence Platform</p>
            </div></body></html>
            """.formatted(code);
    }
}
