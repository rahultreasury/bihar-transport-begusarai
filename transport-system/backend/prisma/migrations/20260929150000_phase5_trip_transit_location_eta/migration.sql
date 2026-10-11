-- =====================================================================
-- Phase 5 — TRANSIT, MOVEMENT TRACKING & ETA
--
-- ADDITIVE ONLY. No existing row is modified, no existing column is
-- renamed or dropped, no data is deleted.
--
-- WHY THESE COLUMNS LIVE ON `trips` AND NOT IN A NEW TABLE
--   The repository ALREADY stores a vehicle's current position in exactly this
--   shape, on `Delivery`:
--       current_latitude / current_longitude / last_location_update
--   Delivery is keyed on booking_id and a Trip may have no Booking at all, so
--   reusing it would silently fail for standalone trips. This migration gives
--   the Trip the SAME vocabulary on the SAME row, rather than inventing a
--   third shape or a continuous tracking table nobody asked for.
--
--   The specification asks for the CURRENT location, not continuous GPS
--   history, so "last known position + when it was taken + where it came from"
--   is the smallest honest model. Movement HISTORY is not stored here — it
--   lives on the existing append-only `trip_timeline`, which is exactly what
--   STEP 4 requires. No TripMovement2 / MovementHistory2 is created.
--
-- WHY NO ETA COLUMN IS INVENTED OUT OF THIN AIR
--   `estimated_arrival_at` is nullable and is only ever written by the server
--   from a REAL Google Distance Matrix call (the integration that already
--   exists in controllers/mapsController.js). `eta_calculated_at` records when
--   that calculation ran, so a stale figure is identifiable rather than
--   presented as if it were live. When no key is configured, no location is
--   known, or the call fails, the ETA is left NULL and the API says so.
--
-- PRODUCTION SAFETY
--   Adding nullable columns to `trips` is non-blocking on PostgreSQL: the
--   table is not rewritten and no existing row is locked beyond the brief
--   ACCESS EXCLUSIVE of an ALTER TABLE. Safe with `prisma migrate deploy`.
-- =====================================================================

-- ── Current position of the vehicle on this trip ────────────────────────
ALTER TABLE "trips"
    ADD COLUMN IF NOT EXISTS "current_latitude" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "current_longitude" DOUBLE PRECISION,
    -- When the position above was taken. NULL means "we have never had a
    -- position", which is different from "the position is stale".
    ADD COLUMN IF NOT EXISTS "location_updated_at" TIMESTAMP(3),
    -- Where the position came from: DRIVER_APP | ADMIN | INTEGRATION.
    ADD COLUMN IF NOT EXISTS "location_source" TEXT,
    -- Metres, when the reporter supplied it.
    ADD COLUMN IF NOT EXISTS "location_accuracy_m" DOUBLE PRECISION;

-- ── Server-calculated ETA ───────────────────────────────────────────────
-- Only ever populated by a real Distance Matrix call. NULL is an honest
-- "no ETA could be computed", never a placeholder number.
ALTER TABLE "trips"
    ADD COLUMN IF NOT EXISTS "estimated_arrival_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "eta_calculated_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "distance_remaining_km" DOUBLE PRECISION;
