-- ============================================================================
-- 20261001120000 · UNIVERSAL VEHICLE HIRE — make the Trip able to exist
--                   BEFORE a vehicle is engaged
-- ============================================================================
--
-- WHY
--   The operational Trip is the single record that both the Enquiry page and
--   the Vehicle Hire page operate on. Today it CANNOT represent the state the
--   business actually calls "WAITING FOR VEHICLE", because `trips.vehicle_id`,
--   `trips.driver_id` and `trips.transport_owner_id` are declared NOT NULL.
--
--   That single schema fact is the structural cause of the reported bug:
--     • A confirmed order whose vehicle has not been engaged yet cannot be
--       stored as a Trip at all, so it is invisible to Vehicle Hire.
--     • An enquiry assignment (Enquiry.assigned_vehicle_id) lives on a
--       different table from the vehicle the Vehicle Hire page reads
--       (Trip.vehicle_id), so the two screens could disagree permanently.
--
--   Relaxing these three columns to NULL lets ONE Trip row carry the whole
--   lifecycle — WAITING FOR VEHICLE → VEHICLE ASSIGNED → VEHICLE HIRED — which
--   is exactly the single source of truth the specification requires.
--
-- WHAT THIS CHANGES (and nothing else)
--   • 3 columns lose their NOT NULL constraint.
--
-- WHAT THIS DOES NOT DO
--   • It deletes nothing. No row is modified. No historical financial record is
--     touched. Every existing Trip keeps its vehicle, driver and owner.
--   • It adds no table. The existing `vehicle_hires` table (UNIQUE on trip_id)
--     remains the one hire record per trip, so a duplicate hire is still
--     impossible at the database level.
--   • It does NOT loosen the application contract: TripService.createTrip
--     still REQUIRES all three for a trip created through POST /api/trips.
--     The relaxation exists so the workflow can *reach* the waiting state, not
--     to let callers skip validation.
--
-- SAFETY
--   DROP NOT NULL never rewrites existing data and cannot fail on a populated
--   table. The statement is idempotent-safe and fully reversible with
--   SET NOT NULL once every live trip has resources again.
-- ============================================================================

ALTER TABLE "trips" ALTER COLUMN "vehicle_id"          DROP NOT NULL;
ALTER TABLE "trips" ALTER COLUMN "driver_id"           DROP NOT NULL;
ALTER TABLE "trips" ALTER COLUMN "transport_owner_id"  DROP NOT NULL;

-- The Vehicle Hire queue is driven by "does this trip have a hire yet", which is
-- a LEFT JOIN on the existing unique (trip_id) key — already covered by
-- vehicle_hires_trip_id_key. These indexes support the operational read path
-- (filter by status, order by recency) that the page issues on every load.
CREATE INDEX IF NOT EXISTS "idx_trips_hire_queue"
  ON "trips" ("status", "trip_date" DESC, "trip_id" DESC);

-- Supports resolving a consignment's canonical trip from its order without a
-- sequential scan. Partial, so it stays small.
CREATE INDEX IF NOT EXISTS "idx_trips_booking_operational"
  ON "trips" ("booking_id")
  WHERE "booking_id" IS NOT NULL;