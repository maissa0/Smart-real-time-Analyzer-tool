-- V10: persist per-rule PASS counters per session.
-- Violations already persist as integrity_faults rows, but passes lived only
-- in the in-memory requirement engine — after a backend restart every passed
-- rule showed as NOT_TESTED in the session requirements report. The snapshot
-- is written by RequirementMonitorService.completeSession() when a session
-- reaches COMPLETE, and removed when the session is deleted.

CREATE TABLE IF NOT EXISTS requirement_rule_coverage (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id     VARCHAR(255) NOT NULL,
    requirement_id VARCHAR(255) NOT NULL,
    pass_count     BIGINT       NOT NULL,
    UNIQUE KEY uq_req_coverage (session_id, requirement_id),
    KEY idx_req_coverage_session (session_id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4;
