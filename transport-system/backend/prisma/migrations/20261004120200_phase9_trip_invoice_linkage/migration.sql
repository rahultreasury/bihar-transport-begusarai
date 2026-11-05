-- ============================================================================
-- PHASE 9 (C) — TRIP <-> INVOICE LINKAGE  (split out of phase9_dispatch_workspace)
-- ============================================================================
--
-- NOT part of the Loading → Dispatch deployment.
--
-- These statements make a trip addressable on the invoice and attribute a
-- customer payment to a specific invoice. They RELAX and EXTEND the customer
-- billing tables, and they are only correct on top of the Phase 7 customer
-- billing integrity work (which is what establishes the one-invoice-per-booking
-- index this file relies on). Loading → Dispatch never bills anybody, so this
-- file ships with the Financial / Phase 7 deployment instead.
--
-- STRICTLY ADDITIVE plus ONE relaxation:
--   `ALTER TABLE invoices ALTER COLUMN booking_id DROP NOT NULL` is the only
--   non-additive statement, and it only widens what is accepted — it never
--   invalidates an existing row. It lets a DIRECT / OFFLINE_CLIENT trip (which
--   has no Booking by design) be billed.
--
-- Safe to run online with `prisma migrate deploy`, safe to re-run.

-- ── Invoice: make it trip-addressable, and give it a real tax breakdown ──
ALTER TABLE "invoices" ALTER COLUMN "booking_id" DROP NOT NULL;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "trip_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "invoice_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "billing_to" TEXT,
  ADD COLUMN IF NOT EXISTS "gst_number" TEXT,
  ADD COLUMN IF NOT EXISTS "gst_type" TEXT,
  ADD COLUMN IF NOT EXISTS "gst_percentage" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "taxable_amount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "cgst" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "sgst" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "igst" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS "document_kind" TEXT DEFAULT 'INTERNAL_CUSTOMER_INVOICE',
  ADD COLUMN IF NOT EXISTS "irn" TEXT,
  ADD COLUMN IF NOT EXISTS "gov_ack_json" TEXT,
  ADD COLUMN IF NOT EXISTS "pdf_generated_at" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_trip_id_fkey'
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_trip_id_fkey"
      FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_invoices_trip" ON "invoices"("trip_id");

-- At most ONE dispatch-linked customer invoice per trip. A PARTIAL unique
-- index is used deliberately: pre-Phase-9 invoices have trip_id = NULL and
-- several NULLs must remain legal, because a booking-scoped invoice and a
-- standalone one are different things and neither should block the other.
-- Prisma's schema language cannot express a partial index, so it is created
-- here and documented in schema.prisma beside `trip_id`.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_one_dispatch_invoice_per_trip"
  ON "invoices"("trip_id")
  WHERE "trip_id" IS NOT NULL AND "document_kind" = 'INTERNAL_CUSTOMER_INVOICE';

-- ── FinancialTransaction: which invoice a customer payment settles ──────
-- The customer money already lives in this ledger. Phase 9 only adds the
-- pointer that lets a PARTIAL payment be attributed to a specific invoice,
-- without copying any amount and without touching the vendor rows.
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "invoice_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_invoice_id_fkey'
  ) THEN
    ALTER TABLE "financial_transactions"
      ADD CONSTRAINT "financial_transactions_invoice_id_fkey"
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("invoice_id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_financial_tx_invoice" ON "financial_transactions"("invoice_id");

-- ── The dispatch record's own pointer at the invoice it raised ──────────
ALTER TABLE "trip_dispatches" ADD COLUMN IF NOT EXISTS "invoice_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_dispatches_invoice_id_fkey'
  ) THEN
    ALTER TABLE "trip_dispatches"
      ADD CONSTRAINT "trip_dispatches_invoice_id_fkey"
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("invoice_id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "trip_dispatches_invoice_id_key" ON "trip_dispatches"("invoice_id");