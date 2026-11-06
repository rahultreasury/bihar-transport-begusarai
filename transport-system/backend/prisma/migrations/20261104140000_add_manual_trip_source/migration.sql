-- Add MANUAL entry channel to TripSourceType, an idempotency key to bookings,
-- and commercial terms storage to trips.
--
-- WHY THIS MIGRATION EXISTS
--   Manual (phone/offline) orders created through "Create Order" must record
--   source = MANUAL on the central Trip record. The TripSourceType enum did
--   not contain a MANUAL value, so this appends it. PostgreSQL's ALTER TYPE
--   ... ADD VALUE only appends; existing values, rows and indexes are untouched,
--   so this is safe on production.
--
--   A nullable `idempotency_key` column is added to bookings with a unique
--   index, so a double-submitted Create Order request (same key) returns the
--   original order instead of inserting a second one. The column is nullable
--   and the unique index permits multiple NULLs, so existing bookings are
--   unaffected.
--
--   A nullable `commercial_terms` JSON column is added to trips to persist the
--   customer-side commercial agreement (rate type, GST, additional charges,
--   payment terms) agreed during the phone call. It is not an accounting
--   posting; no ledger or journal row is written at order creation.
--
-- BACKWARD COMPATIBILITY
--   * Only appends an enum value and adds nullable columns + indexes.
--   * No table is dropped, truncated or rewritten.
--   * No row is deleted or modified.
--   * Safe to apply against production.

-- 1. MANUAL entry channel on Trip.source_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'TripSourceType' AND e.enumlabel = 'MANUAL'
  ) THEN
    ALTER TYPE "TripSourceType" ADD VALUE 'MANUAL';
  END IF;
END $$;

-- 2. Idempotency key column on bookings
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "idempotency_key" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'bookings' AND indexname = 'idx_bookings_idempotency_key'
  ) THEN
    CREATE UNIQUE INDEX "idx_bookings_idempotency_key" ON "bookings"("idempotency_key");
  END IF;
END $$;

-- 3. Commercial terms JSON on trips
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "commercial_terms" json;
