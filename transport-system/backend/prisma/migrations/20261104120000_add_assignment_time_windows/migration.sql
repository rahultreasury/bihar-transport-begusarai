-- Add timezone-aware assignment occupancy windows.
ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "assignment_start_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "assignment_end_at" TIMESTAMPTZ;

-- Enable GiST operator classes for scalar equality.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Vehicle occupancy exclusion.
ALTER TABLE "trips"
  ADD CONSTRAINT "trips_vehicle_time_exclude"
  EXCLUDE USING gist (
    "vehicle_id" WITH =,
    tstzrange("assignment_start_at", "assignment_end_at", '[)') WITH &&
  )
  WHERE (
    "vehicle_id" IS NOT NULL
    AND "assignment_start_at" IS NOT NULL
    AND "assignment_end_at" IS NOT NULL
    AND "status" IN ('PENDING','ASSIGNED','TO_LOADING_POINT','AT_LOADING_POINT','LOADED','DISPATCHED','IN_TRANSIT','DELIVERED')
  );

-- Driver occupancy exclusion.
ALTER TABLE "trips"
  ADD CONSTRAINT "trips_driver_time_exclude"
  EXCLUDE USING gist (
    "driver_id" WITH =,
    tstzrange("assignment_start_at", "assignment_end_at", '[)') WITH &&
  )
  WHERE (
    "driver_id" IS NOT NULL
    AND "assignment_start_at" IS NOT NULL
    AND "assignment_end_at" IS NOT NULL
    AND "status" IN ('PENDING','ASSIGNED','TO_LOADING_POINT','AT_LOADING_POINT','LOADED','DISPATCHED','IN_TRANSIT','DELIVERED')
  );
