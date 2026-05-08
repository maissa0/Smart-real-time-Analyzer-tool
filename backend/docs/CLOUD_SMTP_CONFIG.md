# Cloud & SMTP Configuration Guide – Able Pro IAM

This document provides production-ready configuration guidelines for SMTP, AWS S3, and environment variables.

---

## 1. Environment Variables

Set these in your deployment environment (e.g. Docker, Kubernetes, systemd, or `.env`):

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | 256-bit secret for JWT signing (min 32 chars) | `openssl rand -base64 32` |
| `DB_PASSWORD` | MySQL password | `your-secure-password` |
| `S3_SECRET` | AWS secret key (when using S3 storage) | `wJalr...` |
| `STORAGE_TYPE` | `local` or `s3` | `s3` |
| `S3_BUCKET` | S3 bucket name | `able-pro-iam-avatars` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key (S3) | `AKIA...` |
| `MAIL_HOST` | SMTP host | `smtp.sendgrid.net` |
| `MAIL_PORT` | SMTP port | `587` |
| `MAIL_USERNAME` | SMTP username | `apikey` (SendGrid) |
| `MAIL_PASSWORD` | SMTP password / API key | `SG.xxx...` |

### Example (Docker)

```bash
docker run -e JWT_SECRET="$(openssl rand -base64 32)" \
  -e DB_PASSWORD="secret" \
  -e MAIL_HOST=smtp.sendgrid.net \
  -e MAIL_USERNAME=apikey \
  -e MAIL_PASSWORD=SG.xxx \
  able-pro-iam-backend
```

---

## 2. SMTP Configuration

See **[docs/SMTP_SETUP.md](SMTP_SETUP.md)** for detailed setup.

### Quick Reference

| Provider | Host | Port | Username |
|----------|------|------|----------|
| Mailtrap (dev) | sandbox.smtp.mailtrap.io | 2525 | (from Mailtrap) |
| SendGrid | smtp.sendgrid.net | 587 | `apikey` |
| AWS SES | email-smtp.REGION.amazonaws.com | 587 | (SES SMTP credentials) |

---

## 3. AWS S3 Storage Setup

### 3.1 Create S3 Bucket

1. AWS Console → S3 → Create bucket
2. Bucket name: e.g. `able-pro-iam-avatars`
3. Region: e.g. `us-east-1`
4. Block public access: **Off** (if avatars must be publicly readable) or use CloudFront
5. Create bucket

### 3.2 CORS (if frontend uploads directly)

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedOrigins": ["https://your-app.com"],
    "ExposeHeaders": []
  }
]
```

### 3.3 IAM User & Permissions

1. IAM → Users → Create user (e.g. `able-pro-iam-s3`)
2. Attach policy (or create custom):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::able-pro-iam-avatars/*"
    }
  ]
}
```

3. Create access key for the user
4. Set `AWS_ACCESS_KEY_ID` and `S3_SECRET` (secret key)

### 3.4 application.properties (S3)

```properties
app.storage.type=s3
app.storage.s3.bucket=able-pro-iam-avatars
app.storage.s3.region=us-east-1
app.storage.s3.access-key=${AWS_ACCESS_KEY_ID}
app.storage.s3.secret-key=${S3_SECRET}
app.storage.s3.prefix=avatars
# Optional: CDN URL for public access
app.storage.s3.public-url=https://cdn.example.com/avatars
```

---

## 4. Local Storage (Default)

When `app.storage.type=local` (default):

- Avatars stored in `app.upload.dir` (default: `uploads/avatars`)
- Served via `/uploads/avatars/**`
- Ensure directory exists and is writable

---

## 5. Mail Health Check

After configuring SMTP, verify with:

```bash
curl -H "Authorization: Bearer <admin_token>" \
  http://localhost:8080/api/v1/admin/health/mail
```

Requires `ROLE_ADMIN`.

---

## 6. Security Headers

The application adds these headers automatically:

| Header | Value |
|--------|-------|
| X-Content-Type-Options | nosniff |
| X-Frame-Options | DENY |
| X-XSS-Protection | 1; mode=block |
| Content-Security-Policy | default-src 'self'; ... |
| Strict-Transport-Security | max-age=31536000 (HTTPS only) |

---

## 7. Rate Limiting

Auth endpoints are rate-limited: **5 requests per minute per IP**

- `/api/auth/login`
- `/api/auth/forgot-password`
- `/api/auth/verify-otp`

Exceeding returns `429 Too Many Requests`.
