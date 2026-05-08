-- Test schema for H2 — mirrors production MySQL schema
-- Used by spring.sql.init.schema-locations in application-test.properties

CREATE TABLE IF NOT EXISTS users (
    id BINARY(16) NOT NULL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    job_title VARCHAR(100),
    department VARCHAR(100),
    timezone VARCHAR(50),
    phone VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(255),
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
    id BINARY(16) NOT NULL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
    id BINARY(16) NOT NULL PRIMARY KEY,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id BINARY(16) NOT NULL,
    role_id BINARY(16) NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id BINARY(16) NOT NULL,
    permission_id BINARY(16) NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id BINARY(16) NOT NULL PRIMARY KEY,
    user_id BINARY(16) NOT NULL,
    device VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    last_active TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id BINARY(16) NOT NULL PRIMARY KEY,
    user_id BINARY(16) NOT NULL,
    session_id BINARY(16),
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    device VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
    id BINARY(16) NOT NULL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
    id BINARY(16) NOT NULL PRIMARY KEY,
    user_id BINARY(16) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BINARY(16) NOT NULL PRIMARY KEY,
    user_id BINARY(16),
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(36),
    metadata JSON,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    source VARCHAR(20) NOT NULL DEFAULT 'audit',
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS can_sessions (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL UNIQUE,
    source_filename VARCHAR(255),
    start_ts DOUBLE,
    end_ts DOUBLE,
    frame_count INT,
    created_at DATETIME
);

CREATE TABLE IF NOT EXISTS can_frames (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(255),
    timestamp DOUBLE,
    channel INT,
    channel_name VARCHAR(255),
    msg_id VARCHAR(255),
    msg_name VARCHAR(255),
    direction VARCHAR(255),
    raw_bytes TEXT,
    signals TEXT
);

CREATE TABLE IF NOT EXISTS integrity_faults (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    frame_id BIGINT,
    msg_id VARCHAR(255),
    msg_name VARCHAR(255),
    fault_type VARCHAR(255) NOT NULL,
    description VARCHAR(500),
    frame_timestamp DOUBLE,
    created_at DATETIME
);

CREATE TABLE IF NOT EXISTS log_files (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL UNIQUE,
    filename VARCHAR(255) NOT NULL,
    file_size BIGINT,
    format VARCHAR(10),
    channel_count INT,
    frame_count INT,
    start_ts DOUBLE,
    end_ts DOUBLE,
    duration_seconds DOUBLE,
    status VARCHAR(20) DEFAULT 'pending',
    error_message VARCHAR(500),
    created_at DATETIME NOT NULL,
    completed_at DATETIME
);
