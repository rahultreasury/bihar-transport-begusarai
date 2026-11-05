-- =====================================================================
-- Phase 4 — Trip documents + loading/dispatch operational facts
--
-- ADDITIVE ONLY. No existing row is modified, no existing column is
-- renamed or dropped, no data is deleted.
--
-- This migration is separate from the previous one on purpose: the enum
-- ALTER TYPE ... ADD VALUE must be able to commit before anything depends
-- on the new values.
--
-- 1. Two new enum types
--      TripDocumentType    — what the document IS
--      TripDocumentStatus  — where that document is in its own lifecycle
-- 2. New NULLABLE columns on `trips` for the loading / dispatch facts and
--    for the ACTUAL loaded quantity and weight.
-- 3. New table `trip_documents`.
--
-- ── WHY DOCUMENTS ARE A TABLE AND NOT A TRIP STATUS (STEP 9) ─────────
--   A Trip's operational status and its paperwork are two different facts.
--   There is deliberately NO `LOADED_WITH_LR` style status anywhere in this
--   migration. A trip is `LOADED`; its LR is `PRESENT`; its e-way bill is
--   `VERIFIED`. Storing one as the other would make "is the truck loaded?"
--   and "does the paperwork exist?" impossible to answer independently.
--
-- ── WHY ACTUAL VALUES ARE NEW COLUMNS (STEP 6) ────────────────────────
--   The PLANNED material, quantity and weight already exist on `bookings`
--   (goods_description, number_of_items, quantity_unit, goods_weight_kg,
--   weight_unit). They are the customer's declared figures and are never
--   touched here. The ACTUAL figures weighed and counted at the loading
--   point are a different fact and get their own nullable columns, so a
--   variance is recorded rather than an original overwritten.
--
-- ── WHY THERE IS NO `loading_point` COLUMN ────────────────────────────
--   `trips.pickup_location` / `pickup_city` ARE the loading point for this
--   business — the goods are loaded where they are picked up. Adding a
--   second location column would create two answers to one question, so the
--   loading point is READ from the existing columns instead of duplicated.
--
-- ── WHY `documents_required` IS ON THE TRIP ────────────────────────────
--   Not every consignment needs every paper. The default required set lives
--   in one place (config/tripDocumentPolicy.js); this nullable JSON column
--   lets an admin override it for an individual trip. NULL means "use the
--   default", which is not the same as "no documents required" — an empty
--   array is that.
--
-- PRODUCTION SAFETY
--   Adding nullable columns and creating a new table is non-blocking on
--   PostgreSQL: `trips` is not rewritten and no row is locked beyond the
--   brief ACCESS EXCLUSIVE of an ALTER TABLE. Safe with `migrate deploy`.
-- =====================================================================

-- ── 1) Document type ───────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TripDocumentType') THEN
        CREATE TYPE "TripDocumentType" AS ENUM (
            'LR',              -- Lorry Receipt, issued at loading
            'GR',              -- Goods Receipt, issued at unloading
            'INVOICE',
            'E_WAY_BILL',      -- statutory road-freight e-way bill
            'INSURANCE',
            'PERMIT',
            'FITNESS',
            'RC',              -- Registration Certificate
            'POD',             -- Proof of Delivery
            'OTHER'
        );
    END IF;
END $$;

-- ── 2) Document status (independent of the Trip's operational status) ──
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TripDocumentStatus') THEN
        CREATE TYPE "TripDocumentStatus" AS ENUM (
            'PENDING',    -- expected for this trip, not yet supplied
            'PRESENT',    -- supplied, not yet verified
            'VERIFIED',   -- checked and accepted
            'REJECTED',   -- supplied but not acceptable
            'EXPIRED'     -- valid until a date that has now passed
        );
    END IF;
END $$;

-- ── 3) Loading / dispatch facts on `trips` ─────────────────────────────
-- Every column is NULLABLE, so all 17 pre-existing trips stay valid and are
-- not given an invented loading history.
ALTER TABLE "trips"
    -- Departure towards the loading point.
    ADD COLUMN IF NOT EXISTS "sent_to_loading_at" TIMESTAMP(3),
    -- Arrived at the loading point and waiting.
    ADD COLUMN IF NOT EXISTS "arrived_at_loading_at" TIMESTAMP(3),
    -- Physical loading window.
    ADD COLUMN IF NOT EXISTS "loading_started_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "loading_completed_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "loading_remarks" TEXT,
    ADD COLUMN IF NOT EXISTS "loaded_by" TEXT,
    -- Left the loading point.
    ADD COLUMN IF NOT EXISTS "dispatched_at" TIMESTAMP(3),
    -- ACTUAL figures recorded at loading. The PLANNED figures remain on the
    -- booking and are never overwritten.
    ADD COLUMN IF NOT EXISTS "actual_quantity" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "actual_quantity_unit" TEXT,
    ADD COLUMN IF NOT EXISTS "actual_weight_kg" DOUBLE PRECISION,
    -- Per-trip override of the mandatory document set. NULL = use the
    -- repository default from config/tripDocumentPolicy.js.
    ADD COLUMN IF NOT EXISTS "documents_required" JSONB;

-- ── 4) The trip document table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "trip_documents" (
    "document_id"     SERIAL PRIMARY KEY,

    "trip_id"         INTEGER NOT NULL,
    "document_type"   "TripDocumentType" NOT NULL,
    "document_status" "TripDocumentStatus" NOT NULL DEFAULT 'PENDING',

    -- Identity of the document itself. Unique per trip + type so one LR per
    -- trip cannot be recorded twice by a retry.
    "reference_number" VARCHAR,

    -- Dates that apply to SOME document types (issue, expiry) and are NULL
    -- for the ones they do not apply to (e.g. an invoice has no expiry).
    "issued_at"       TIMESTAMP(3),
    "expires_at"      TIMESTAMP(3),

    -- Upload / generation state. `file_url` is deliberately NOT public: the
    -- API that serves it is admin-gated, see services/TripDocumentService.
    "file_url"        TEXT,
    "is_uploaded"     BOOLEAN NOT NULL DEFAULT false,
    "is_verified"     BOOLEAN NOT NULL DEFAULT false,
    "verified_by"     INTEGER,
    "verified_at"     TIMESTAMP(3),

    "remarks"         TEXT,

    "created_by"      INTEGER,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_documents_trip_id_fkey"
        FOREIGN KEY ("trip_id") REFERENCES "trips" ("trip_id") ON DELETE CASCADE
);

-- At most one document of each type per trip: this is what makes recording a
-- document idempotent under a retry.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_trip_documents_trip_type"
    ON "trip_documents" ("trip_id", "document_type");

CREATE INDEX IF NOT EXISTS "idx_trip_documents_status"
    ON "trip_documents" ("document_status");

CREATE INDEX IF NOT EXISTS "idx_trip_documents_trip"
    ON "trip_documents" ("trip_id");
