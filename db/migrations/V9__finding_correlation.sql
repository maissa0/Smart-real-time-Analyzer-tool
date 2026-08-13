-- ═══════════════════════════════════════════════════════════════════════════
-- V9 — finding correlation (Phase 5: fusion + diagnostic guidance)
-- The backend correlator groups findings that share an ECU/subsystem within a
-- short time window into a "probable root cause" cluster, and merges ML
-- findings that overlap a REQUIREMENT finding window (the ML finding becomes
-- supporting evidence and its severity may be boosted above LOW).
-- All columns are nullable additions; existing rows keep working unchanged.
-- Apply manually (no Flyway wired):  mysql -u root -p kpit_db < V9__finding_correlation.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE integrity_faults
    ADD COLUMN cluster_id VARCHAR(120) NULL
        COMMENT 'Root-cause cluster key (session-scoped): findings of one subsystem within one time window share it',
    ADD COLUMN correlation_json TEXT NULL
        COMMENT 'JSON correlation links: for REQUIREMENT findings the supporting ML evidence, for ML findings the requirement finding they support';

CREATE INDEX idx_integrity_faults_session_cluster
    ON integrity_faults (session_id, cluster_id);
