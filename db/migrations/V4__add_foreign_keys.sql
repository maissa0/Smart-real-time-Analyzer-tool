-- ============================================================
-- V4__add_foreign_keys.sql
-- Add missing FK constraints between CAN tables.
-- FKs can_sessions→cars and log_files→cars already added in V3.
-- Target: smart_real_time_analyser
-- Author: Maissa Drira — KPIT PFE 2026
-- Depends on: V3__car_seed_and_assignment.sql
-- Pre-conditions verified before running:
--   - can_frames orphan_frames = 0
--   - integrity_faults orphan_faults = 0
--   - can_frames.session_id and can_sessions.session_id
--     both varchar(255) utf8mb4_unicode_ci
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- FK 1 — can_frames → can_sessions
-- Enforces: every frame must belong to a known session.
-- ON DELETE CASCADE: deleting a session deletes all its frames.
-- This prevents orphan frames from accumulating again.
-- ────────────────────────────────────────────────────────────
ALTER TABLE can_frames
    ADD CONSTRAINT fk_can_frames_session
        FOREIGN KEY (session_id)
        REFERENCES can_sessions (session_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────
-- FK 2 — integrity_faults → can_sessions
-- Enforces: every fault must belong to a known session.
-- ON DELETE CASCADE: deleting a session deletes all its faults.
-- ────────────────────────────────────────────────────────────
ALTER TABLE integrity_faults
    ADD CONSTRAINT fk_integrity_faults_session
        FOREIGN KEY (session_id)
        REFERENCES can_sessions (session_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE;

-- ============================================================
-- END OF V4
-- ============================================================
