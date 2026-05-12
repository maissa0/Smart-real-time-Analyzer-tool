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
        String subject = "Welcome to KPIT Smart CAN Analyser";
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
            <p class="footer">KPIT Smart CAN Analyser — Real-Time CAN Bus Analysis Platform</p>
            </body>
            </html>
            """.formatted(safeName.replace("<", ""), introText != null ? introText.replace("<", "") : "");
        sendHtmlEmail(toEmail, subject, htmlBody);
    }

    /**
     * Sends a first-time invitation email with a direct set-password link.
     * The link contains a one-use JWT reset token (15-min expiry).
     */
    @Async
    public void sendInvitationEmail(String toEmail, String recipientName, String setPasswordUrl) {
        String safeName = recipientName != null ? recipientName : "User";
        String subject = "You've been invited to KPIT Smart CAN Analyser";
        String htmlBody = """
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><style>
              body { font-family: Arial, sans-serif; background:#f4f4f4; margin:0; padding:0; }
              .container { max-width:520px; margin:40px auto; background:#ffffff; border-radius:8px; overflow:hidden; }
              .header { background:#0d1117; padding:24px 32px; }
              .header h1 { color:#b0ff44; margin:0; font-size:20px; letter-spacing:0.05em; }
              .header p { color:#8a9ab0; margin:4px 0 0; font-size:13px; }
              .body { padding:32px; }
              .body p { color:#333; font-size:14px; line-height:1.6; }
              .btn { display:inline-block; margin:24px 0; padding:12px 28px;
                     background:#b0ff44; color:#07090b; text-decoration:none;
                     border-radius:6px; font-weight:700; font-size:15px; }
              .note { font-size:12px; color:#888; margin-top:8px; }
              .footer { background:#f9f9f9; padding:16px 32px; font-size:11px; color:#aaa; border-top:1px solid #eee; }
            </style></head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>KPIT ANALYSER</h1>
                  <p>Smart Real-Time CAN Bus Analysis Platform</p>
                </div>
                <div class="body">
                  <p>Hello <strong>%s</strong>,</p>
                  <p>You have been invited to join the <strong>KPIT Smart CAN Analyser</strong> platform.
                     Click the button below to set your password and activate your account.</p>
                  <a href="%s" class="btn">Set My Password</a>
                  <p class="note">⚠ This link expires in <strong>15 minutes</strong>.
                     If it expires, ask your administrator to resend the invitation.</p>
                  <p>Your login email: <strong>%s</strong></p>
                </div>
                <div class="footer">
                  KPIT Smart CAN Analyser — Real-Time CAN Bus Analysis Platform<br>
                  This email was sent automatically. Please do not reply.
                </div>
              </div>
            </body>
            </html>
            """.formatted(safeName, setPasswordUrl, toEmail);
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
              <p class="footer">KPIT Smart CAN Analyser</p>
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
              <h2>Welcome to KPIT Smart CAN Analyser</h2>
              <p>Hi %s,</p>
              <p>Your account has been successfully created. You can now sign in and start using the platform.</p>
              <p>If you have any questions, please contact your administrator.</p>
              <p class="footer">KPIT Smart CAN Analyser</p>
            </div></body></html>
            """.formatted(name);
    }
}
