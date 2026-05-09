-- ============================================================
-- V3__car_seed_and_assignment.sql
-- Add car_id to can_sessions and log_files, insert seed cars,
-- assign all existing sessions to the Legacy placeholder car.
-- Target: smart_real_time_analyser
-- Author: Maissa Drira — KPIT PFE 2026
-- Depends on: V2__create_new_tables.sql (cars table must exist)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- SECTION 1 — Add car_id to can_sessions
-- Deferred from V2 — Car JPA entity now ready for Sprint 5.
-- FK constraint added after seed data is inserted.
-- ────────────────────────────────────────────────────────────
ALTER TABLE can_sessions
    ADD COLUMN car_id BIGINT DEFAULT NULL
                      COMMENT 'FK to cars.id — vehicle that generated this session';

ALTER TABLE can_sessions
    ADD INDEX idx_can_sessions_car_id (car_id);

-- ────────────────────────────────────────────────────────────
-- SECTION 2 — Add car_id to log_files
-- ────────────────────────────────────────────────────────────
ALTER TABLE log_files
    ADD COLUMN car_id BIGINT DEFAULT NULL
                      COMMENT 'FK to cars.id — vehicle associated with this log file';

ALTER TABLE log_files
    ADD INDEX idx_log_files_car_id (car_id);

-- ────────────────────────────────────────────────────────────
-- SECTION 3 — Insert seed cars
-- ────────────────────────────────────────────────────────────

-- Car 1: Legacy placeholder — owns all pre-migration sessions
INSERT INTO cars (
    car_uid, make, model, year,
    is_virtual, is_active,
    created_at, updated_at
) VALUES (
    UUID(),
    'Legacy',
    'Pre-Migration Sessions',
    2026,
    TRUE,
    TRUE,
    NOW(), NOW()
);

SET @legacy_id = LAST_INSERT_ID();

-- Car 2: KPIT CAN Simulator virtual car
INSERT INTO cars (
    car_uid, make, model, year,
    is_virtual, is_active,
    created_at, updated_at
) VALUES (
    UUID(),
    'KPIT',
    'CAN Simulator',
    2026,
    TRUE,
    TRUE,
    NOW(), NOW()
);

-- ────────────────────────────────────────────────────────────
-- SECTION 4 — Assign all existing sessions to Legacy car
-- Every session created before the Car entity existed is
-- assigned to the Legacy placeholder car.
-- ────────────────────────────────────────────────────────────
UPDATE can_sessions
SET car_id = @legacy_id
WHERE car_id IS NULL;

-- ────────────────────────────────────────────────────────────
-- SECTION 5 — Add FK constraints now that data is consistent
-- ────────────────────────────────────────────────────────────
ALTER TABLE can_sessions
    ADD CONSTRAINT fk_can_sessions_car
        FOREIGN KEY (car_id) REFERENCES cars (id)
        ON DELETE SET NULL;

ALTER TABLE log_files
    ADD CONSTRAINT fk_log_files_car
        FOREIGN KEY (car_id) REFERENCES cars (id)
        ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- POST-CHECKS (run manually to verify)
-- ────────────────────────────────────────────────────────────
-- SELECT COUNT(*) as null_car_id FROM can_sessions WHERE car_id IS NULL;
-- Expected: 0
-- SELECT car_id, COUNT(*) as cnt FROM can_sessions GROUP BY car_id;
-- Expected: one row with @legacy_id and count = 88
-- SELECT COUNT(*) FROM cars;
-- Expected: 2

-- ============================================================
-- END OF V3
-- ============================================================
