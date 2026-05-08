-- ============================================================
-- V2__create_new_tables.sql
-- New tables for KPIT Smart Real-Time CAN Analyser
-- Supports: Car entity, AI detection, export jobs,
--           signal thresholds, user preferences
-- Target: smart_real_time_analyser (tested on smart_analyser_test)
-- Author: Maissa Drira — KPIT PFE 2026
-- Depends on: V1__fix_existing_tables.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- TABLE 1 — ecu_catalogs
-- References XML catalog files used by the Python pipeline.
-- Created before cars because cars.ecu_catalog_id FKs here.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecu_catalogs (
    id          BIGINT          NOT NULL AUTO_INCREMENT,
    name        VARCHAR(100)    NOT NULL COMMENT 'Human-readable catalog name (e.g. powertrain_can)',
    filename    VARCHAR(255)    NOT NULL COMMENT 'XML filename relative to catalogues/ directory',
    bus_name    VARCHAR(64)     NOT NULL COMMENT 'CAN bus name (e.g. Powertrain_CAN)',
    version     VARCHAR(20)     DEFAULT NULL COMMENT 'Optional version tag',
    description VARCHAR(500)    DEFAULT NULL,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ecu_catalogs_filename (filename),
    INDEX idx_ecu_catalogs_bus_name (bus_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='XML ECU signal catalogs used by the Python decoder pipeline';

-- ────────────────────────────────────────────────────────────
-- TABLE 2 — cars
-- Vehicle entity linking sessions to a specific physical car.
-- car_id will be added to can_sessions and log_files in V3
-- once the JPA entity is implemented and validated.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cars (
    id              BIGINT          NOT NULL AUTO_INCREMENT,
    car_uid         VARCHAR(36)     NOT NULL COMMENT 'Public UUID identifier for this car',
    vin             VARCHAR(17)     DEFAULT NULL COMMENT 'Vehicle Identification Number (17 chars ISO 3779)',
    make            VARCHAR(100)    NOT NULL COMMENT 'Manufacturer (e.g. Toyota, BMW)',
    model           VARCHAR(100)    NOT NULL COMMENT 'Model name (e.g. Corolla, 3 Series)',
    year            SMALLINT        NOT NULL COMMENT 'Model year (e.g. 2024)',
    color           VARCHAR(50)     DEFAULT NULL,
    ecu_catalog_id  BIGINT          DEFAULT NULL COMMENT 'FK to ecu_catalogs.id — default catalog for this car',
    owner_user_id   BINARY(16)      DEFAULT NULL COMMENT 'FK to users.id — car owner',
    is_virtual      BOOLEAN         NOT NULL DEFAULT FALSE
                                    COMMENT 'TRUE for simulator-only cars with no physical VIN',
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL COMMENT 'Soft delete timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uq_cars_car_uid (car_uid),
    UNIQUE KEY uq_cars_vin (vin),
    INDEX idx_cars_owner_user_id (owner_user_id),
    INDEX idx_cars_ecu_catalog_id (ecu_catalog_id),
    INDEX idx_cars_is_active (is_active),
    CONSTRAINT fk_cars_ecu_catalog
        FOREIGN KEY (ecu_catalog_id) REFERENCES ecu_catalogs (id)
        ON DELETE SET NULL,
    CONSTRAINT fk_cars_owner_user
        FOREIGN KEY (owner_user_id) REFERENCES users (id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Physical or virtual vehicles monitored by the CAN analyser';

-- ────────────────────────────────────────────────────────────
-- TABLE 3 — signal_definitions
-- Individual signal metadata extracted from ECU catalogs.
-- Enables per-signal threshold and anomaly configuration.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_definitions (
    id              BIGINT          NOT NULL AUTO_INCREMENT,
    ecu_catalog_id  BIGINT          NOT NULL COMMENT 'FK to ecu_catalogs.id',
    signal_name     VARCHAR(128)    NOT NULL COMMENT 'Signal identifier as in XML catalog',
    msg_id          VARCHAR(20)     DEFAULT NULL COMMENT 'Parent message ID',
    msg_name        VARCHAR(100)    DEFAULT NULL COMMENT 'Parent message name',
    unit            VARCHAR(32)     DEFAULT NULL COMMENT 'Physical unit (km/h, rpm, °C …)',
    min_value       DOUBLE          DEFAULT NULL COMMENT 'Minimum valid physical value',
    max_value       DOUBLE          DEFAULT NULL COMMENT 'Maximum valid physical value',
    description     VARCHAR(500)    DEFAULT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_signal_def_catalog_name (ecu_catalog_id, signal_name),
    INDEX idx_signal_def_signal_name (signal_name),
    INDEX idx_signal_def_msg_id (msg_id),
    CONSTRAINT fk_signal_def_catalog
        FOREIGN KEY (ecu_catalog_id) REFERENCES ecu_catalogs (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Individual signal metadata from ECU XML catalogs';

-- ────────────────────────────────────────────────────────────
-- TABLE 4 — signal_thresholds
-- Configurable alert thresholds per signal per car.
-- Used by the Z-score adaptive thresholding in Sprint 6.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_thresholds (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    car_id              BIGINT          NOT NULL COMMENT 'FK to cars.id',
    signal_name         VARCHAR(128)    NOT NULL COMMENT 'Signal identifier',
    threshold_type      ENUM('min','max','zscore','range')
                                        NOT NULL DEFAULT 'range',
    min_value           DOUBLE          DEFAULT NULL,
    max_value           DOUBLE          DEFAULT NULL,
    zscore_sensitivity  DOUBLE          DEFAULT 3.0
                                        COMMENT 'Z-score multiplier for adaptive thresholding',
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_by          BINARY(16)      DEFAULT NULL COMMENT 'FK to users.id',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_threshold_car_signal (car_id, signal_name),
    INDEX idx_threshold_car_id (car_id),
    INDEX idx_threshold_signal_name (signal_name),
    CONSTRAINT fk_threshold_car
        FOREIGN KEY (car_id) REFERENCES cars (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-car per-signal alert thresholds for anomaly detection';

-- ────────────────────────────────────────────────────────────
-- TABLE 5 — anomaly_results
-- Stores AI/ML anomaly detection results (Sprint 6).
-- IsolationForest and RandomForest results both stored here.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_results (
    id              BIGINT          NOT NULL AUTO_INCREMENT,
    session_id      VARCHAR(255)    NOT NULL COMMENT 'FK logic to can_sessions.session_id',
    car_id          BIGINT          DEFAULT NULL COMMENT 'FK to cars.id',
    frame_id        BIGINT          DEFAULT NULL COMMENT 'FK logic to can_frames.id',
    signal_name     VARCHAR(128)    DEFAULT NULL,
    algorithm       ENUM('isolation_forest','random_forest','zscore','manual')
                                    NOT NULL DEFAULT 'isolation_forest',
    anomaly_score   DOUBLE          DEFAULT NULL COMMENT 'Raw score from the algorithm',
    is_anomaly      BOOLEAN         NOT NULL DEFAULT FALSE,
    severity        ENUM('low','medium','high','critical')
                                    DEFAULT NULL,
    description     VARCHAR(500)    DEFAULT NULL,
    detected_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by     BINARY(16)      DEFAULT NULL COMMENT 'FK to users.id — reviewer',
    reviewed_at     DATETIME        DEFAULT NULL,
    PRIMARY KEY (id),
    INDEX idx_anomaly_session_id (session_id),
    INDEX idx_anomaly_car_id (car_id),
    INDEX idx_anomaly_is_anomaly (is_anomaly),
    INDEX idx_anomaly_algorithm (algorithm),
    INDEX idx_anomaly_detected_at (detected_at),
    INDEX idx_anomaly_severity (severity),
    CONSTRAINT fk_anomaly_car
        FOREIGN KEY (car_id) REFERENCES cars (id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI/ML anomaly detection results per session and signal';

-- ────────────────────────────────────────────────────────────
-- TABLE 6 — export_jobs
-- Tracks PDF/CSV export requests (Sprint 6 iText7 export).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_jobs (
    id              BIGINT          NOT NULL AUTO_INCREMENT,
    job_uid         VARCHAR(36)     NOT NULL COMMENT 'Public UUID for polling status',
    session_id      VARCHAR(255)    DEFAULT NULL COMMENT 'Source session for the export',
    requested_by    BINARY(16)      NOT NULL COMMENT 'FK to users.id',
    format          ENUM('pdf','csv','xlsx')
                                    NOT NULL DEFAULT 'pdf',
    status          ENUM('pending','processing','completed','failed')
                                    NOT NULL DEFAULT 'pending',
    file_path       VARCHAR(500)    DEFAULT NULL COMMENT 'Server path to generated file',
    file_size       BIGINT          DEFAULT NULL COMMENT 'File size in bytes',
    error_message   VARCHAR(500)    DEFAULT NULL,
    requested_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME        DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_export_jobs_uid (job_uid),
    INDEX idx_export_requested_by (requested_by),
    INDEX idx_export_session_id (session_id),
    INDEX idx_export_status (status),
    INDEX idx_export_requested_at (requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Async export job tracking for PDF/CSV/XLSX report generation';

-- ────────────────────────────────────────────────────────────
-- TABLE 7 — user_preferences
-- Per-user application settings (Sprint 7).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    user_id             BINARY(16)      NOT NULL COMMENT 'FK to users.id',
    theme               ENUM('light','dark','system')
                                        NOT NULL DEFAULT 'system',
    default_car_id      BIGINT          DEFAULT NULL COMMENT 'FK to cars.id',
    language            VARCHAR(10)     NOT NULL DEFAULT 'fr'
                                        COMMENT 'BCP 47 language tag (fr, en, ar)',
    notifications_email BOOLEAN         NOT NULL DEFAULT TRUE,
    notifications_app   BOOLEAN         NOT NULL DEFAULT TRUE,
    dashboard_layout    JSON            DEFAULT NULL
                                        COMMENT 'Saved widget positions and sizes',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_preferences_user_id (user_id),
    INDEX idx_user_prefs_default_car (default_car_id),
    CONSTRAINT fk_user_prefs_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_user_prefs_default_car
        FOREIGN KEY (default_car_id) REFERENCES cars (id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-user application preferences and dashboard configuration';

-- ============================================================
-- END OF V2
-- ============================================================
