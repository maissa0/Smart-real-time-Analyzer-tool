-- ═══════════════════════════════════════════════════════════════════════════
-- V5 — car_catalogs join table
-- Lets users assign one or more ECU catalogs to a car. The simulator restricts
-- generated traffic for that car to the assigned catalog files; no rows means
-- "use all catalogs" (legacy behaviour, backwards compatible).
-- Apply manually (no Flyway wired):  mysql -u root -p kpit_db < V5__car_catalogs.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS car_catalogs (
    car_id      BIGINT NOT NULL COMMENT 'FK to cars.id',
    catalog_id  BIGINT NOT NULL COMMENT 'FK to ecu_catalogs.id',

    PRIMARY KEY (car_id, catalog_id),
    INDEX idx_car_catalogs_catalog_id (catalog_id),

    CONSTRAINT fk_car_catalogs_car
        FOREIGN KEY (car_id) REFERENCES cars (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_car_catalogs_catalog
        FOREIGN KEY (catalog_id) REFERENCES ecu_catalogs (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Catalogs assigned per car — empty set = all catalogs';
