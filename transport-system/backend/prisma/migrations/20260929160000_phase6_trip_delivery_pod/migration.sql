-- =====================================================================
-- Phase 6 — DELIVERY, POD & COMPLETION
--
-- ADDITIVE ONLY. No existing row is modified, no existing column is
-- renamed or dropped, no data is deleted, no enum value is renamed.
--
-- WHY SO FEW COLUMNS
--   Most of what delivery needs ALREADY EXISTS and is reused, not re-added:
--
--     DELIVERED timestamp  -> `trips.trip_delivered_date`   (pre-existing)
--     COMPLETED timestamp  -> `trips.completed_at`          (pre-existing)
--     POD document         -> `trip_documents` where
--                              document_type = 'POD'        (Phase 4)
--     POD verification     -> `trip_documents.document_status`
--                              PRESENT / VERIFIED          (Phase 4)
--     POD file / signature -> `trip_documents.file_url`
--     POD uploaded by      -> `trip_documents.created_by`
--     delivery timeline    -> `trip_timeline`               (Phase 4)
--
--   So this migration adds ONLY the facts that had nowhere to live:
--
--   1. `arrived_at_destination_at` — the truck physically reached the drop
--      point. This is the delivery-side analogue of the EXISTING
--      `arrived_at_loading_at`, and it is a prerequisite for DELIVERED.
--      A destination arrival is a FACT recorded on the trip, exactly as
--      `sent_to_loading_at` / `dispatched_at` already are — it deliberately
--      does NOT add a new TripStatus, because the existing statuses already
--      express the workflow (STEP 3: reuse, do not add).
--
--   2. `arrival_remarks` — free text recorded with that arrival.
--
--   3. POD delivery facts that are not documents and not timestamps:
--      who received the goods, remarks, and the quantity/weight ACTUALLY
--      RECEIVED.
--
--   The received figures are deliberately SEPARATE from `actual_quantity` /
--   `actual_weight_kg`, which are the LOADING actuals, and both are separate
--   from the PLANNED quantity/weight on Booking/Enquiry. Nothing here ever
--   overwrites a planned or a loaded value (STEP 7 / tests 31-33).
--
-- PRODUCTION SAFETY
--   Adding nullable columns to `trips` is non-blocking on PostgreSQL: the
--   table is not rewritten and no existing row is locked beyond the brief
--   ACCESS EXCLUSIVE of an ALTER TABLE. Safe with `prisma migrate deploy`.
-- =====================================================================

-- ── Arrival at the destination ───────────────────────────────────────────
ALTER TABLE "trips"
    ADD COLUMN IF NOT EXISTS "arrived_at_destination_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "arrival_remarks" TEXT;

-- ── Proof-of-delivery facts ─────────────────────────────────────────────
-- `delivered_receiver_name` — who actually took the goods. A POD without a
-- named receiver is not evidence of anything, so the DELIVERED transition
-- requires it.
ALTER TABLE "trips"
    ADD COLUMN IF NOT EXISTS "delivered_receiver_name" TEXT,
    ADD COLUMN IF NOT EXISTS "delivery_remarks" TEXT,
    -- ACTUAL RECEIVED figures. Never overwrite the planned quantity/weight on
    -- Booking/Enquiry, nor the loaded actuals on this same row.
    ADD COLUMN IF NOT EXISTS "delivered_quantity" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "delivered_quantity_unit" TEXT,
    ADD COLUMN IF NOT EXISTS "delivered_weight_kg" DOUBLE PRECISION;
