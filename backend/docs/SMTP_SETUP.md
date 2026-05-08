# SMTP Setup Guide – Able Pro IAM

This guide explains how to configure email (SMTP) for development and production environments.

---

## 1. Development: Mailtrap

[Mailtrap](https://mailtrap.io/) captures outgoing emails for testing without sending to real inboxes.

### 1.1 Create a Mailtrap Account

1. Sign up at [mailtrap.io](https://mailtrap.io/)
2. Create an inbox (e.g. "Able Pro IAM Dev")
3. Go to **SMTP Settings** and copy credentials

### 1.2 application.properties (Mailtrap)

```properties
# Mailtrap - Development
spring.mail.host=sandbox.smtp.mailtrap.io
spring.mail.port=2525
spring.mail.username=${MAILTRAP_USERNAME:your_mailtrap_username}
spring.mail.password=${MAILTRAP_PASSWORD:your_mailtrap_password}
spring.mail.properties.mail.smtp.auth=true
spring.mail.properties.mail.smtp.starttls.enable=true
app.mail.from-name=Able Pro IAM
```

Or use environment variables:

```bash
export MAILTRAP_USERNAME=your_username
export MAILTRAP_PASSWORD=your_password
```

---

## 2. Production: SendGrid

[SendGrid](https://sendgrid.com/) is a popular transactional email provider.

### 2.1 Create SendGrid Account

1. Sign up at [sendgrid.com](https://sendgrid.com/)
2. Verify your sender identity (domain or single sender)
3. Create an API Key: **Settings → API Keys → Create API Key** (Restricted, Mail Send)

### 2.2 application.properties (SendGrid)

```properties
# SendGrid - Production
spring.mail.host=smtp.sendgrid.net
spring.mail.port=587
spring.mail.username=apikey
spring.mail.password=${SENDGRID_API_KEY}
spring.mail.properties.mail.smtp.auth=true
spring.mail.properties.mail.smtp.starttls.enable=true
app.mail.from-name=Able Pro IAM
```

**Note:** The username is literally `apikey`; the password is your SendGrid API key.

---

## 3. Production: AWS SES

[Amazon Simple Email Service (SES)](https://aws.amazon.com/ses/) is suitable for high-volume production.

### 3.1 Prerequisites

- AWS account
- Verified email or domain in SES
- IAM user with `ses:SendEmail` permission

### 3.2 application.properties (AWS SES)

```properties
# AWS SES - Production
spring.mail.host=email-smtp.us-east-1.amazonaws.com
spring.mail.port=587
spring.mail.username=${AWS_SES_SMTP_USERNAME}
spring.mail.password=${AWS_SES_SMTP_PASSWORD}
spring.mail.properties.mail.smtp.auth=true
spring.mail.properties.mail.smtp.starttls.enable=true
app.mail.from-name=Able Pro IAM
```

**Note:** Use SES SMTP credentials (not IAM access keys). Create them in **SES → SMTP settings → Create SMTP credentials**.

### 3.3 Region-Specific Hosts

| Region | SMTP Host |
|--------|-----------|
| us-east-1 | email-smtp.us-east-1.amazonaws.com |
| eu-west-1 | email-smtp.eu-west-1.amazonaws.com |
| ap-southeast-1 | email-smtp.ap-southeast-1.amazonaws.com |

---

## 4. Mail Health Check

Use the admin endpoint to verify SMTP connectivity:

```http
GET /api/v1/admin/health/mail
Authorization: Bearer <admin_access_token>
```

**Response (success):**
```json
{
  "status": "OK",
  "message": "Test email sent successfully"
}
```

**Response (failure):**
```json
{
  "status": "ERROR",
  "message": "Failed to send test email: ..."
}
```

Requires `ROLE_ADMIN`.

---

## 5. Environment Variables Summary

| Variable | Description | Example |
|----------|-------------|---------|
| `MAILTRAP_USERNAME` | Mailtrap SMTP username | (from Mailtrap inbox) |
| `MAILTRAP_PASSWORD` | Mailtrap SMTP password | (from Mailtrap inbox) |
| `SENDGRID_API_KEY` | SendGrid API key | SG.xxx... |
| `AWS_SES_SMTP_USERNAME` | AWS SES SMTP username | AKIA... |
| `AWS_SES_SMTP_PASSWORD` | AWS SES SMTP password | (from SES SMTP credentials) |

---

## 6. Troubleshooting

| Issue | Solution |
|-------|----------|
| `AuthenticationFailedException` | Verify username/password; for SendGrid use `apikey` as username |
| `MessagingException` | Check firewall/port (587, 465, 2525); enable STARTTLS if required |
| Emails not received | Check spam; verify sender domain in production |
| Connection timeout | Ensure outbound SMTP is allowed; try port 465 (SSL) if 587 fails |
