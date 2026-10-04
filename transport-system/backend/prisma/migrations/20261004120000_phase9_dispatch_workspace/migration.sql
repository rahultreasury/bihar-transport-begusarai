-- ============================================================================
-- PHASE 9 (A) — DISPATCH WORKSPACE
-- ============================================================================
--
-- SCOPE OF THIS FILE — the DISPATCH HALF OF PHASE 9 ONLY.
--
-- Created here:
--   • trip_dispatches   — the dispatch ACT (one row per trip, enforced by
--                         PostgreSQL, not by application discipline)
--   • eway_bills        — the INTERNAL e-way bill record (no government API)
--   • trip_insurances   — transit insurance for the consignment
--
-- DELIBERATELY NOT IN THIS FILE:
--   • trip_incidents / trip_vehicle_changes  -> 20261004120100 (Transit)
--   • invoices.* / financial_transactions.*  -> 20261004120200 (Invoice linkage)
--     Those depend on the Phase 7 customer-billing integrity work and must not
--     land with Loading / Dispatch.
--
-- STRICTLY ADDITIVE. Nothing here drops a column, rewrites a row, deletes data
-- or resets a sequence. Every statement is CREATE TABLE IF NOT EXISTS,
-- ALTER TABLE ... ADD COLUMN IF NOT NULL, or CREATE INDEX IF NOT EXISTS, so the
-- whole file is safe to run online with `prisma migrate deploy` and is safe to
-- re-run.
--
-- HONESTY CONSTRAINT CARRIED BY THIS MIGRATION
--   eway_bills.gov_sync_status defaults to 'NOT_CONNECTED' and every gov_*
--   column is NULL. There is no government e-way bill API in this system, so
--   nothing may ever assert a government confirmation without one.

-- ── 1. Trip: the three dispatch-time decisions ─────────────────────────────
ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "pod_required" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "insurance_required" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "value_of_goods" DOUBLE PRECISION;

-- ── 2. The dispatch act ────────────────────────────────────────────────────
-- UNIQUE (trip_id): a consignment is dispatched at most once, enforced by
-- PostgreSQL rather than by application discipline. A double click or an API
-- retry physically cannot create a second dispatch record.
CREATE TABLE IF NOT EXISTS "trip_dispatches" (
  "dispatch_id"            SERIAL PRIMARY KEY,
  "trip_id"                INTEGER NOT NULL,
  "dispatched_at"          TIMESTAMP(3) NOT NULL,
  "dispatch_origin"        TEXT NOT NULL DEFAULT 'ADMIN',

  "lr_gr_number"           TEXT,
  "lr_gr_document_id"      INTEGER,
  "lr_gr_remarks"          TEXT,

  "delivery_number"        TEXT,
  "consignee_name"         TEXT,
  "consignee_contact"      TEXT,
  "consignee_address"      TEXT,

  "value_of_goods"         DOUBLE PRECISION,
  "actual_quantity"        DOUBLE PRECISION,
  "actual_quantity_unit"   TEXT,
  "actual_weight_kg"       DOUBLE PRECISION,

  "eway_bill_id"           INTEGER,
  "insurance_id"           INTEGER,

  "pod_required"           BOOLEAN NOT NULL DEFAULT false,
  "status"                 TEXT NOT NULL DEFAULT 'DISPATCHED',

  "created_by"             INTEGER,
  "created_at"             TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trip_dispatches_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE,
  CONSTRAINT "trip_dispatches_lr_gr_document_id_fkey"
    FOREIGN KEY ("lr_gr_document_id") REFERENCES "trip_documents"("document_id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "trip_dispatches_trip_id_key" ON "trip_dispatches"("trip_id");
CREATE INDEX IF NOT EXISTS "idx_trip_dispatch_trip" ON "trip_dispatches"("trip_id");
CREATE INDEX IF NOT EXISTS "idx_trip_dispatch_at" ON "trip_dispatches"("dispatched_at");

-- ── 3. E-way bill: internal record vs government confirmation ──────────────
CREATE TABLE IF NOT EXISTS "eway_bills" (
  "eway_bill_id"              SERIAL PRIMARY KEY,
  "trip_id"                   INTEGER NOT NULL,

  "eway_bill_number"          TEXT,
  "eway_bill_date"            TIMESTAMP(3),
  "expiry_at"                 TIMESTAMP(3),
  "internal_status"           TEXT NOT NULL DEFAULT 'PENDING',
  "document_id"               INTEGER,
  "remarks"                   TEXT,

  "current_vehicle_number"    TEXT,
  "previous_vehicle_number"   TEXT,
  "vehicle_update_required"   BOOLEAN NOT NULL DEFAULT false,

  -- EMPTY BY DESIGN. No government API is connected.
  "gov_sync_status"           TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
  "gov_eway_bill_number"      TEXT,
  "gov_synced_at"             TIMESTAMP(3),
  "gov_response"              TEXT,

  "created_by"                INTEGER,
  "created_at"                TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "eway_bills_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE,
  CONSTRAINT "eway_bills_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "trip_documents"("document_id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "eway_bills_trip_id_key" ON "eway_bills"("trip_id");
CREATE INDEX IF NOT EXISTS "idx_eway_bill_trip" ON "eway_bills"("trip_id");
CREATE INDEX IF NOT EXISTS "idx_eway_bill_number" ON "eway_bills"("eway_bill_number");

-- trip_dispatches.eway_bill_id → eway_bills (added after both tables exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_dispatches_eway_bill_id_fkey'
  ) THEN
    ALTER TABLE "trip_dispatches"
      ADD CONSTRAINT "trip_dispatches_eway_bill_id_fkey"
      FOREIGN KEY ("eway_bill_id") REFERENCES "eway_bills"("eway_bill_id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "trip_dispatches_eway_bill_id_key" ON "trip_dispatches"("eway_bill_id");

-- ── 4. Transit insurance ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "trip_insurances" (
  "insurance_id"      SERIAL PRIMARY KEY,
  "trip_id"           INTEGER NOT NULL,
  "insured"           BOOLEAN NOT NULL DEFAULT false,
  "insurance_company" TEXT,
  "policy_number"     TEXT,
  "sum_insured"       DOUBLE PRECISION,
  "goods_value"       DOUBLE PRECISION,
  "claim_contact"     TEXT,
  "valid_from"        TIMESTAMP(3),
  "valid_to"          TIMESTAMP(3),
  "document_id"       INTEGER,
  "status"            TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  "remarks"           TEXT,
  "created_by"        INTEGER,
  "created_at"        TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trip_insurances_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE,
  CONSTRAINT "trip_insurances_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "trip_documents"("document_id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "trip_insurances_trip_id_key" ON "trip_insurances"("trip_id");
CREATE INDEX IF NOT EXISTS "idx_trip_insurance_trip" ON "trip_insurances"("trip_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_dispatches_insurance_id_fkey'
  ) THEN
    ALTER TABLE "trip_dispatches"
      ADD CONSTRAINT "trip_dispatches_insurance_id_fkey"
      FOREIGN KEY ("insurance_id") REFERENCES "trip_insurances"("insurance_id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "trip_dispatches_insurance_id_key" ON "trip_dispatches"("insurance_id");
