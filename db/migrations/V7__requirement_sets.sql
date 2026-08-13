-- ═══════════════════════════════════════════════════════════════════════════
-- V7 — requirement sets (dynamic per-car behavioral requirements)
-- Users upload requirement-set YAML files and assign them to cars, exactly
-- like ECU catalogs (V5). The requirements engine evaluates each session only
-- against the files assigned to the session's car. Empty assignment = engine
-- disabled for that car (no merged-global fallback).
-- Apply manually (no Flyway wired):  mysql -u root -p kpit_db < V7__requirement_sets.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS requirement_sets (
    id          BIGINT NOT NULL AUTO_INCREMENT,
    name        VARCHAR(100) NOT NULL COMMENT 'Display name from the file meta',
    filename    VARCHAR(255) NOT NULL COMMENT 'YAML filename in the requirements directory',
    version     VARCHAR(20)  NULL,
    description VARCHAR(500) NULL,
    rule_count  INT          NOT NULL DEFAULT 0,
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME(6)  NOT NULL,
    updated_at  DATETIME(6)  NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_requirement_sets_filename (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Registry of user-uploaded requirement-set YAML files';

CREATE TABLE IF NOT EXISTS car_requirement_sets (
    car_id             BIGINT NOT NULL COMMENT 'FK to cars.id',
    requirement_set_id BIGINT NOT NULL COMMENT 'FK to requirement_sets.id',

    PRIMARY KEY (car_id, requirement_set_id),
    INDEX idx_car_requirement_sets_req_id (requirement_set_id),

    CONSTRAINT fk_car_requirements_car
        FOREIGN KEY (car_id) REFERENCES cars (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_car_requirements_set
        FOREIGN KEY (requirement_set_id) REFERENCES requirement_sets (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Requirement sets assigned per car — empty set = requirements engine off';
