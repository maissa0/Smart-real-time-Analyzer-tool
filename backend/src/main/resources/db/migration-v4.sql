CREATE TABLE IF NOT EXISTS session_summaries (
    session_id   VARCHAR(36)  NOT NULL PRIMARY KEY,
    report_text  LONGTEXT     NOT NULL,
    model_used   VARCHAR(100),
    signal_count INT,
    error_count  INT,
    generated_at DATETIME     NOT NULL
);