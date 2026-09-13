-- Migration: Allow standalone Trip financials (booking_id nullable)
-- Purpose: A Trip created without a Booking (offline/direct) must still have a
--          FinancialTransaction ledger. Previously TripFinancial had
--          booking_id NOT NULL + @unique, which made standalone trips impossible.
--
-- Safe & additive:
--   * booking_id becomes nullable (keeps existing rows intact)
--   * trip_id column links a TripFinancial directly to its Trip
--   * the implicit unique index on booking_id is dropped (it came from @unique)
--   * a partial unique index keeps at most ONE financial per booking when set
--   * FKs + indexes are added idempotently

-- 0. Ensure the FinancialTransactionType enum has every value the app uses.
--    The legacy DB shipped a partial enum; the app code references
--    CLIENT_PAYMENT / TRIP_EXPENSE / EXPENSE_REIMBURSEMENT / REVERSAL.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='CLIENT_PAYMENT' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='FinancialTransactionType')) THEN
    ALTER TYPE "FinancialTransactionType" ADD VALUE 'CLIENT_PAYMENT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='TRIP_EXPENSE' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='FinancialTransactionType')) THEN
    ALTER TYPE "FinancialTransactionType" ADD VALUE 'TRIP_EXPENSE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='EXPENSE_REIMBURSEMENT' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='FinancialTransactionType')) THEN
    ALTER TYPE "FinancialTransactionType" ADD VALUE 'EXPENSE_REIMBURSEMENT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='REVERSAL' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='FinancialTransactionType')) THEN
    ALTER TYPE "FinancialTransactionType" ADD VALUE 'REVERSAL';
  END IF;
END $$;

-- 1. Drop the implicit unique constraint on booking_id (from the old @unique).
ALTER TABLE "trip_financials"
  DROP CONSTRAINT IF EXISTS "trip_financials_booking_id_key";

-- 2. Make booking_id nullable.
ALTER TABLE "trip_financials"
  ALTER COLUMN "booking_id" DROP NOT NULL;

-- 3. Add trip_id column (nullable for booking-linked rows).
ALTER TABLE "trip_financials"
  ADD COLUMN IF NOT EXISTS "trip_id" INTEGER;

-- 4. Partial unique index: at most one financial per booking (when booking_id set).
CREATE UNIQUE INDEX IF NOT EXISTS "trip_financials_booking_id_unique"
  ON "trip_financials"("booking_id")
  WHERE "booking_id" IS NOT NULL;

-- 5. Foreign key: trip_financials -> trips (nullable, cascade).
ALTER TABLE "trip_financials"
  ADD CONSTRAINT "trip_financials_trip_id_fkey"
  FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id")
  ON UPDATE CASCADE ON DELETE CASCADE;

-- 6. Indexes.
CREATE INDEX IF NOT EXISTS "idx_trip_financial_trip" ON "trip_financials"("trip_id");
CREATE INDEX IF NOT EXISTS "idx_trip_financial_booking" ON "trip_financials"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_trip_financial_status" ON "trip_financials"("status");