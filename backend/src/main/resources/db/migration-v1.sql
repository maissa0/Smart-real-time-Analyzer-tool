-- Migration v1: Add phone, bio, avatar_url, job_title, department, timezone, mfa_secret to users
-- Add otp_codes table, session_id to refresh_tokens
-- If you get "Duplicate column name 'phone'" → run migration-v2.sql instead (you already have phone/bio/avatar_url)

USE able_pro_iam;
-- Or: USE smart_real_time_analyser;  (adjust to your schema)

-- Users: add columns (skip any that already exist)
ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL AFTER full_name;
ALTER TABLE users ADD COLUMN bio TEXT NULL AFTER phone;
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL AFTER bio;
ALTER TABLE users ADD COLUMN job_title VARCHAR(100) NULL AFTER full_name;
ALTER TABLE users ADD COLUMN department VARCHAR(100) NULL AFTER job_title;
ALTER TABLE users ADD COLUMN timezone VARCHAR(50) NULL DEFAULT 'UTC' AFTER department;
ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(255) NULL AFTER mfa_enabled;

-- MFA recovery codes (backup codes)
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  user_id     BINARY(16)   NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,
  used_at     DATETIME(6)  NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_mfa_recovery_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_mfa_recovery_codes_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OTP codes table (forgot-password flow)
CREATE TABLE IF NOT EXISTS otp_codes (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  code        VARCHAR(6)   NOT NULL,
  expires_at  DATETIME(6)  NOT NULL,
  used_at     DATETIME(6)  NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_otp_codes_email (email),
  INDEX idx_otp_codes_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refresh tokens: link to session (for session revocation)
ALTER TABLE refresh_tokens ADD COLUMN session_id BINARY(16) NULL AFTER user_id;
