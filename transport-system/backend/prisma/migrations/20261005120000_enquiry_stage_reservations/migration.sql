-- ============================================================================
-- 20261005120000_enquiry_stage_reservations
-- ============================================================================
-- ENQUIRY-STAGE RESERVATIONS (the temporary hold before the customer accepts)
--
-- WHY
--   A vehicle and a driver are now assigned BEFORE the customer accepts. At that
--   moment there is no Booking yet, so the existing `reservations` table — whose
--   `booking_id` was NOT NULL — could not express "this truck and this driver are
--   being held for this enquiry". This migration extends that ONE existing table
--   rather than introducing a second reservation concept.
--
--   Reservation   = the temporary hold. Has NO money. NOT a hire. NOT a Trip.
--   VehicleHire   = the confirmed agreement. Exists only after acceptance.
--   Trip          = the consignment. Exists only after acceptance.
--
-- SAFETY
--   * Additive and reversible.
--   * `reservations` currently holds 0 rows, so relaxing NOT NULL cannot orphan
--     or reinterpret an existing booking-scoped reservation.
--   * Dropping NOT NULL is a RELAXATION: every query that already filtered
--     `where: { booking_id: <value>, status: 'ACTIVE' }` (ReservationRepository,
--     BookingService) keeps working unchanged, because a NULL booking_id can
--     never equal a concrete id.
--   * ON DELETE CASCADE on booking_id/enquiry_id is preserved: deleting the
--     parent still removes its holds.
--
-- LOCAL ONLY. Not deployed. Neon does not have this migration.
-- ============================================================================

-- ── 1. booking_id becomes optional ───────────────────────────────────────────
-- A pre-acceptance hold belongs to the Enquiry, not to a Booking.
ALTER TABLE "reservations" ALTER COLUMN "booking_id" DROP NOT NULL;

-- ── 2. the enquiry parent ────────────────────────────────────────────────────
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "enquiry_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_enquiry_id_fkey'
  ) THEN
    ALTER TABLE "reservations"
      ADD CONSTRAINT "reservations_enquiry_id_fkey"
      FOREIGN KEY ("enquiry_id") REFERENCES "enquiries"("enquiry_id")
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END
$$;

-- Read path: "the reservations of this enquiry", and the ACTIVE filter.
CREATE INDEX IF NOT EXISTS "idx_reservations_enquiry" ON "reservations" ("enquiry_id");

-- ── 3. a reservation must belong to SOMETHING ─────────────────────────────────
-- "At least one parent", NOT "exactly one": at the moment of acceptance the
-- enquiry's Booking is created and linked, so a converted reservation legitimately
-- carries BOTH ids. What must never exist is a hold owned by nothing, which would
-- be invisible to every cleanup, expiry and release path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_have_a_parent'
  ) THEN
    ALTER TABLE "reservations"
      ADD CONSTRAINT "reservations_have_a_parent"
      CHECK ("booking_id" IS NOT NULL OR "enquiry_id" IS NOT NULL);
  END IF;
END
$$;

-- ── 4. ONE active hold per resource ──────────────────────────────────────────
-- Partial UNIQUE indexes, so the database — not application discipline —
-- prevents double-booking. `WHERE ... IS NOT NULL` matters: vehicle_id and
-- driver_id are legitimately NULL (a hold may be created before both resources
-- are chosen), and PostgreSQL would otherwise treat each NULL as distinct and
-- allow unlimited partial holds.
--
--   one ACTIVE hold per ENQUIRY  → an enquiry can never hold two trucks
--   one ACTIVE hold per VEHICLE  → a truck can never be promised twice
--   one ACTIVE hold per DRIVER   → a driver can never be promised twice
--
-- Only ACTIVE rows are constrained: a RELEASED / EXPIRED / CONVERTED row keeps
-- its history and immediately frees the resource for a new hold.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_reservations_active_enquiry"
  ON "reservations" ("enquiry_id")
  WHERE "status" = 'ACTIVE' AND "enquiry_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_reservations_active_vehicle"
  ON "reservations" ("vehicle_id")
  WHERE "status" = 'ACTIVE' AND "vehicle_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_reservations_active_driver"
  ON "reservations" ("driver_id")
  WHERE "status" = 'ACTIVE' AND "driver_id" IS NOT NULL;
