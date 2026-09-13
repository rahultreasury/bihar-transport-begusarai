-- =====================================================================
-- Migration: add_trip_expense_paid_by_receipt
-- Phase 3 — Redesign Trips around real Bihar Transport broker economics.
--
-- ADDITIVE ONLY — does not modify or delete any existing data.
-- Existing historical financial records are preserved unchanged.
--
-- Changes:
--   1. New enum values on trip_expense_type (LABOUR, DOCUMENTATION,
--      PARKING, LOCAL_TRANSPORT, CUSTOMER_RELATED, COMMUNICATION).
--   2. New enum type expense_paid_by (BIHAR_TRANSPORT, TRANSPORT_OWNER).
--   3. New column trip_expenses.paid_by (default BIHAR_TRANSPORT).
--   4. New column trip_expenses.receipt (nullable text).
--
-- Rationale:
--   The broker model requires distinguishing Bihar Transport expenses
--   from Transport Owner expenses. An owner-paid diesel/maintenance/toll
--   expense must NOT reduce BT Net Profit. The `paid_by` column is the
--   canonical discriminator. `receipt` supports the Add Expense UX.
-- =====================================================================

-- 1) Extend the trip_expense_type enum with new practical categories.
--    PostgreSQL requires ADD VALUE for existing enums.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'trip_expense_type' AND e.enumlabel = 'LABOUR'
    ) THEN
        ALTER TYPE "trip_expense_type" ADD VALUE 'LABOUR';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'trip_expense_type' AND e.enumlabel = 'DOCUMENTATION'
    ) THEN
        ALTER TYPE "trip_expense_type" ADD VALUE 'DOCUMENTATION';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'trip_expense_type' AND e.enumlabel = 'PARKING'
    ) THEN
        ALTER TYPE "trip_expense_type" ADD VALUE 'PARKING';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'trip_expense_type' AND e.enumlabel = 'LOCAL_TRANSPORT'
    ) THEN
        ALTER TYPE "trip_expense_type" ADD VALUE 'LOCAL_TRANSPORT';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'trip_expense_type' AND e.enumlabel = 'CUSTOMER_RELATED'
    ) THEN
        ALTER TYPE "trip_expense_type" ADD VALUE 'CUSTOMER_RELATED';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'trip_expense_type' AND e.enumlabel = 'COMMUNICATION'
    ) THEN
        ALTER TYPE "trip_expense_type" ADD VALUE 'COMMUNICATION';
    END IF;
END $$;

-- 2) Create the new expense_paid_by enum type.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'expense_paid_by'
    ) THEN
        CREATE TYPE "expense_paid_by" AS ENUM ('BIHAR_TRANSPORT', 'TRANSPORT_OWNER');
    END IF;
END $$;

-- 3) Add paid_by column (default BIHAR_TRANSPORT so existing rows are
--    treated as BT expenses — preserving prior behaviour where all expenses
--    were implicitly BT expenses).
ALTER TABLE "trip_expenses"
    ADD COLUMN IF NOT EXISTS "paid_by" "expense_paid_by" NOT NULL DEFAULT 'BIHAR_TRANSPORT';

-- 4) Add receipt column (nullable — no existing data affected).
ALTER TABLE "trip_expenses"
    ADD COLUMN IF NOT EXISTS "receipt" TEXT;

-- 5) Index for efficient BT-only expense filtering.
CREATE INDEX IF NOT EXISTS "idx_trip_expenses_paid_by" ON "trip_expenses" ("paid_by");
