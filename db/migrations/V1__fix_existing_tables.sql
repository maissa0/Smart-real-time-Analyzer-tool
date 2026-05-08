-- ============================================================
-- V1__fix_existing_tables.sql
-- Schema fixes for KPIT Smart Real-Time CAN Analyser
-- Target: smart_real_time_analyser (tested on smart_analyser_test)
-- Author: Maissa Drira — KPIT PFE 2026
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PRE-CHECKS (informational — do not block migration)
-- ────────────────────────────────────────────────────────────

-- Verify orphan count before delete (expect 18238 on first run, 0 after)
-- SELECT COUNT(*) as orphan_frames_before
-- FROM can_frames cf
-- LEFT JOIN can_sessions cs ON cf.session_id = cs.session_id
-- WHERE cs.session_id IS NULL;

-- Verify invalid JSON count (must be 0 before converting signals to JSON)
-- SELECT COUNT(*) as invalid_json
-- FROM can_frames
-- WHERE JSON_VALID(signals) = 0 AND signals IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- SECTION 1 — Delete orphan frames
-- Frames whose session_id has no matching can_sessions row.
-- These are unreachable via normal session→frames queries.
-- Decision: delete (Option A) — 18238 rows, 4.7% of total data.
-- ────────────────────────────────────────────────────────────
DELETE FROM can_frames
WHERE session_id NOT IN (
    SELECT session_id FROM can_sessions
);

-- ────────────────────────────────────────────────────────────
-- SECTION 2 — Fix can_frames column types
-- ────────────────────────────────────────────────────────────

-- 2a. signals: TEXT → JSON
--     Pre-check confirmed 0 invalid JSON rows — safe to convert.
--     JSON type enables JSON_EXTRACT(), JSON_VALID() and future indexing.
ALTER TABLE can_frames
    MODIFY COLUMN signals JSON DEFAULT NULL;

-- 2b. raw_bytes: TEXT → VARCHAR(30)
--     Max actual length in production data: 24 chars.
--     VARCHAR(30) is sufficient and avoids TEXT overhead.
ALTER TABLE can_frames
    MODIFY COLUMN raw_bytes VARCHAR(30) DEFAULT NULL;

-- 2c. direction: VARCHAR(255) → ENUM
--     All production values are 'Rx' or 'Tx' (mixed case — verified).
--     ENUM enforces only valid values and reduces storage from 255 to 1 byte.
--     'Unknown' added as safe default for future unknown directions.
ALTER TABLE can_frames
    MODIFY COLUMN direction ENUM('Rx','Tx','Unknown') DEFAULT 'Unknown';

-- 2d. Tighten oversized VARCHAR columns
--     Actual max lengths: msg_id=5, msg_name=21, channel_name=14
--     Using safe margins: 20, 100, 64
ALTER TABLE can_frames
    MODIFY COLUMN msg_id       VARCHAR(20)  DEFAULT NULL,
    MODIFY COLUMN msg_name     VARCHAR(100) DEFAULT NULL,
    MODIFY COLUMN channel_name VARCHAR(64)  DEFAULT NULL;

-- ────────────────────────────────────────────────────────────
-- SECTION 3 — Extend can_sessions
-- Add columns needed for Sprint 5 (user ownership, status tracking).
-- car_id intentionally excluded — added in V2 with cars table.
-- ────────────────────────────────────────────────────────────
ALTER TABLE can_sessions
    ADD COLUMN user_id    BINARY(16)   DEFAULT NULL COMMENT 'FK to users.id — owner of this session',
    ADD COLUMN status     ENUM('live','completed','failed','archived')
                          NOT NULL DEFAULT 'completed'
                          COMMENT 'Lifecycle status of the session',
    ADD COLUMN updated_at DATETIME     DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP
                          COMMENT 'Last modification timestamp';

-- Index on user_id for user-scoped session queries
ALTER TABLE can_sessions
    ADD INDEX idx_can_sessions_user_id (user_id),
    ADD INDEX idx_can_sessions_status  (status);

-- ────────────────────────────────────────────────────────────
-- SECTION 4 — Add missing indexes to integrity_faults
-- Currently only PRIMARY key — full table scans on session_id queries.
-- ────────────────────────────────────────────────────────────
ALTER TABLE integrity_faults
    ADD INDEX idx_integrity_faults_session_id  (session_id),
    ADD INDEX idx_integrity_faults_fault_type  (fault_type),
    ADD INDEX idx_integrity_faults_frame_id    (frame_id),
    ADD INDEX idx_integrity_faults_created_at  (created_at);

-- ────────────────────────────────────────────────────────────
-- SECTION 5 — Add missing index to log_files
-- Currently PRIMARY + UQ on session_id only.
-- ────────────────────────────────────────────────────────────
ALTER TABLE log_files
    ADD INDEX idx_log_files_status (status);

-- ────────────────────────────────────────────────────────────
-- POST-CHECKS
-- ────────────────────────────────────────────────────────────

-- Verify orphan frames deleted (expect 0)
-- SELECT COUNT(*) as orphan_frames_after
-- FROM can_frames cf
-- LEFT JOIN can_sessions cs ON cf.session_id = cs.session_id
-- WHERE cs.session_id IS NULL;

-- Verify can_frames count after delete
-- SELECT COUNT(*) as frame_count FROM can_frames;
-- Expected: 390092 - 18238 = 371854

-- ============================================================
-- END OF V1
-- ============================================================
