-- =====================================================================
-- Migration: enforce_driver_owner_not_null
-- Phase 2 — STAGE 3 (operator-gated).
--
-- DO NOT RUN THIS MIGRATION until
--   scripts/backfill-orphan-drivers.js
-- has been executed against the database AND its summary has reported
--   "Orphans after : 0".
--
-- This migration will FAIL at the DB level if any rows in drivers still
-- have transport_owner_id IS NULL when it runs.
-- =====================================================================

-- 1) Enforce NOT NULL on the column.
ALTER TABLE "drivers"
  ALTER COLUMN "transport_owner_id" SET NOT NULL;

-- 2) Re-add the FK with ON DELETE RESTRICT. Deleting an owner that
--    still has drivers will now be rejected at the DB layer. The
--    application layer also enforces this, but the DB constraint is
--    the last line of defence.
ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_transport_owner_id_fkey"
  FOREIGN KEY ("transport_owner_id")
  REFERENCES "vehicle_owners"("owner_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- 3) The pre-existing index "idx_drivers_transport_owner" on
--    (transport_owner_id) remains valid and useful for owner-scoped
--    driver lookups. No change.