package com.example.backend.service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * Email service using Spring Mail (JavaMailSender).
 * Supports HTML templates for forgot-password OTP and welcome emails.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailService {

    private final JavaMailSender mailSender;

    @Value("${app.mail.from:noreply@ablepro.com}")
    private String fromEmail;

    @Value("${app.mail.from-name:Able Pro IAM}")
    private String fromName;

    @Async
    public void sendForgotPasswordOtp(String toEmail, String otpCode) {
        String subject = "Password Reset - Your Verification Code";
        String htmlBody = buildOtpEmailHtml(otpCode);
        sendHtmlEmail(toEmail, subject, htmlBody);
    }

    @Async
    public void sendWelcomeEmail(String toEmail, String userName) {
        String subject = "Welcome to Able Pro IAM";
        String htmlBody = buildWelcomeEmailHtml(userName);
        sendHtmlEmail(toEmail, subject, htmlBody);
    }

    /**
     * Invitation / set-password notice (HTML). Body text is caller-provided.
     */
    @Async
    public void sendPasswordResetEmail(String toEmail, String recipientName, String introText) {
        String safeName = recipientName != null ? recipientName : "User";
        String subject = "KPIT Smart CAN Analyser — Set your password";
        String htmlBody = """
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <p>Hello %s,</p>
            <p>%s</p>
            <p>Use <strong>Forgot password</strong> on the login page to receive a verification code and choose your password.</p>
            </body>
            </html>
            """.formatted(safeName.replace("<", ""), introText != null ? introText.replace("<", "") : "");
        sendHtmlEmail(toEmail, subject, htmlBody);
    }

    /**
     * Synchronous test email for health check (not @Async).
     */
    public void sendTestEmailSync(String toEmail) {
        String subject = "Able Pro IAM - Mail Health Check";
        String htmlBody = """
            <!DOCTYPE html><html><body>
            <p>This is a test email from the Able Pro IAM Mail Health Check endpoint.</p>
            <p>If you received this, SMTP is configured correctly.</p>
            </body></html>""";
        sendHtmlEmail(toEmail, subject, htmlBody);
    }

    private void sendHtmlEmail(String to, String subject, String htmlBody) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(fromEmail, fromName);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(htmlBody, true);
            mailSender.send(message);
            log.debug("Email sent to {}", to);
        } catch (MessagingException | java.io.UnsupportedEncodingException e) {
            log.error("Failed to send email to {}: {}", to, e.getMessage());
            throw new RuntimeException("Failed to send email", e);
        }
    }

    private String buildOtpEmailHtml(String code) {
        return """
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 500px; margin: 0 auto; padding: 20px; }
              .code-box { background: #f4f4f4; border: 2px dashed #333; padding: 20px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 8px; margin: 20px 0; }
              .footer { font-size: 12px; color: #666; margin-top: 30px; }
            </style></head>
            <body><div class="container">
              <h2>Password Reset Request</h2>
              <p>You requested a password reset. Use the following code to verify your identity:</p>
              <div class="code-box">%s</div>
              <p>This code expires in 5 minutes. If you did not request this, please ignore this email.</p>
              <p class="footer">Able Pro IAM - Identity & Access Management</p>
            </div></body></html>
            """.formatted(code);
    }

    private String buildWelcomeEmailHtml(String userName) {
        String name = (userName != null && !userName.isBlank()) ? userName : "there";
        return """
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 500px; margin: 0 auto; padding: 20px; }
              .footer { font-size: 12px; color: #666; margin-top: 30px; }
            </style></head>
            <body><div class="container">
              <h2>Welcome to Able Pro IAM</h2>
              <p>Hi %s,</p>
              <p>Your account has been successfully created. You can now sign in and start using the platform.</p>
              <p>If you have any questions, please contact your administrator.</p>
              <p class="footer">Able Pro IAM - Identity & Access Management</p>
            </div></body></html>
            """.formatted(name);
    }
}
