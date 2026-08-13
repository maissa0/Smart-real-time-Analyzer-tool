-- ═══════════════════════════════════════════════════════════════════════════
-- V8 — findings layers (requirements engine, Phase 2)
-- integrity_faults becomes the single findings store for all detection layers:
--   layer = SPEC        — deterministic spec checks (IntegrityAnalyzerService)
--   layer = REQUIREMENT — requirements-engine findings (RequirementMonitorService);
--                         requirement_id / severity / evidence / check-list come
--                         from the violated rule in the per-car requirement file
--   layer = ML          — reserved for the Phase-4 anomaly engine
-- All columns are nullable additions; existing SPEC rows keep working unchanged.
-- Apply manually (no Flyway wired):  mysql -u root -p kpit_db < V8__findings_layers.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE integrity_faults
    ADD COLUMN layer VARCHAR(16) NOT NULL DEFAULT 'SPEC'
        COMMENT 'Detection layer: SPEC | REQUIREMENT | ML',
    ADD COLUMN requirement_id VARCHAR(100) NULL
        COMMENT 'Rule id from the requirement file (REQUIREMENT layer only)',
    ADD COLUMN severity VARCHAR(16) NULL
        COMMENT 'Rule severity: CRITICAL|HIGH|MEDIUM|LOW|INFO (REQUIREMENT layer)',
    ADD COLUMN evidence_json TEXT NULL
        COMMENT 'JSON evidence: trigger ts, deadline, observed value/latency',
    ADD COLUMN check_list_json TEXT NULL
        COMMENT 'JSON array of diagnostic check-list entries from the rule';

CREATE INDEX idx_integrity_faults_session_layer
    ON integrity_faults (session_id, layer);
