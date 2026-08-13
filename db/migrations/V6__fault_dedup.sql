-- ═══════════════════════════════════════════════════════════════════════════
-- V6 — integrity fault dedup / flood control
-- Repeated identical faults (same session, message, fault type, signal) now
-- increment `occurrences` on the existing row instead of inserting a new row,
-- so a stuck signal on a fast cyclic message cannot flood the table.
-- `last_seen_ts` records the frame timestamp (absolute Unix seconds) of the
-- most recent occurrence; `frame_timestamp` keeps the first.
-- Apply manually (no Flyway wired):  mysql -u root -p kpit_db < V6__fault_dedup.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE integrity_faults
    ADD COLUMN occurrences INT NOT NULL DEFAULT 1
        COMMENT 'Repeat count of this exact fault within the session',
    ADD COLUMN last_seen_ts DOUBLE NULL
        COMMENT 'Frame timestamp (Unix seconds) of the most recent occurrence';
