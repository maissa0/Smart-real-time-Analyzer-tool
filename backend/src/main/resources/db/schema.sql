-- =============================================================================
-- Able Pro IAM - MySQL Schema (MySQL Workbench Optimized)
-- Compatible with MySQL 8.0+
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS able_pro_iam
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE able_pro_iam;

-- -----------------------------------------------------------------------------
-- users (with soft delete: deleted_at)
-- is_active: master switch for account access (1=active, 0=disabled)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS mfa_recovery_codes;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS permissions;

CREATE TABLE users (
  id              BINARY(16)    NOT NULL PRIMARY KEY,
  email           VARCHAR(255)  NOT NULL,
  username        VARCHAR(100)  NOT NULL,
  password_hash   VARCHAR(255)  NOT NULL,
  full_name       VARCHAR(255)  NULL,
  job_title       VARCHAR(100)  NULL,
  department      VARCHAR(100)  NULL,
  timezone        VARCHAR(50)   NULL DEFAULT 'UTC',
  phone           VARCHAR(50)  NULL,
  bio             TEXT          NULL,
  avatar_url      VARCHAR(500)  NULL,
  mfa_secret      VARCHAR(255)  NULL,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  mfa_enabled     TINYINT(1)    NOT NULL DEFAULT 0,
  verified        TINYINT(1)    NOT NULL DEFAULT 0,
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at      DATETIME(6)   NULL,
  UNIQUE KEY uk_users_email (email),
  UNIQUE KEY uk_users_username (username),
  INDEX idx_users_is_active (is_active),
  INDEX idx_users_created_at (created_at),
  INDEX idx_users_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- roles
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- permissions
-- -----------------------------------------------------------------------------
CREATE TABLE permissions (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  slug        VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_permissions_slug (slug),
  INDEX idx_permissions_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- user_roles (many-to-many)
-- -----------------------------------------------------------------------------
CREATE TABLE user_roles (
  user_id     BINARY(16)  NOT NULL,
  role_id     BINARY(16)  NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- role_permissions (many-to-many)
-- -----------------------------------------------------------------------------
CREATE TABLE role_permissions (
  role_id       BINARY(16)  NOT NULL,
  permission_id BINARY(16)  NOT NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- audit_logs (JSON metadata column)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  user_id     BINARY(16)   NULL,
  action      VARCHAR(100) NOT NULL,
  resource    VARCHAR(100) NOT NULL,
  resource_id VARCHAR(36)  NULL,
  metadata    JSON         NULL,
  ip_address  VARCHAR(45)  NULL,
  user_agent  VARCHAR(500) NULL,
  source      ENUM('audit', 'security') NOT NULL DEFAULT 'audit',
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_audit_logs_user_id (user_id),
  INDEX idx_audit_logs_action (action),
  INDEX idx_audit_logs_resource (resource),
  INDEX idx_audit_logs_created_at (created_at),
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- sessions (active sessions for Security Center)
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  user_id     BINARY(16)   NOT NULL,
  device      VARCHAR(255) NULL,
  ip_address  VARCHAR(45)  NULL,
  user_agent  VARCHAR(500) NULL,
  last_active DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_sessions_user_id (user_id),
  INDEX idx_sessions_last_active (last_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- mfa_recovery_codes (one-time backup codes for MFA)
-- -----------------------------------------------------------------------------
CREATE TABLE mfa_recovery_codes (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  user_id     BINARY(16)   NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,
  used_at     DATETIME(6)  NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_mfa_recovery_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_mfa_recovery_codes_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- otp_codes (for forgot-password OTP, 5-minute expiry)
-- -----------------------------------------------------------------------------
CREATE TABLE otp_codes (
  id          BINARY(16)   NOT NULL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  code        VARCHAR(6)   NOT NULL,
  expires_at  DATETIME(6)  NOT NULL,
  used_at     DATETIME(6)  NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_otp_codes_email (email),
  INDEX idx_otp_codes_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- refresh_tokens (for token rotation and remote logout)
-- -----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id            BINARY(16)   NOT NULL PRIMARY KEY,
  user_id       BINARY(16)   NOT NULL,
  session_id    BINARY(16)   NULL,
  token_hash    VARCHAR(255) NOT NULL,
  device        VARCHAR(255) NULL,
  ip_address    VARCHAR(45)  NULL,
  user_agent    VARCHAR(500) NULL,
  expires_at    DATETIME(6)  NOT NULL,
  revoked_at    DATETIME(6)  NULL,
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_tokens_session FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  UNIQUE KEY uk_refresh_tokens_token_hash (token_hash),
  INDEX idx_refresh_tokens_user_id (user_id),
  INDEX idx_refresh_tokens_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- Seed data: Run DataInitializer on app startup, or uncomment below for manual seed.
-- -----------------------------------------------------------------------------
