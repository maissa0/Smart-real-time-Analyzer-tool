CREATE TABLE IF NOT EXISTS can_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL UNIQUE,
    source_filename VARCHAR(255),
    start_ts DOUBLE,
    end_ts DOUBLE,
    frame_count INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS can_frames (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    timestamp DOUBLE,
    channel INT,
    channel_name VARCHAR(50),
    msg_id VARCHAR(20),
    msg_name VARCHAR(100),
    direction VARCHAR(5),
    raw_bytes TEXT,
    signals TEXT,
    INDEX idx_session_id (session_id),
    INDEX idx_msg_id (msg_id)
);
