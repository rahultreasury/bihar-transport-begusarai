-- Recovery migration: remove the global per-resource unique active assignment indexes.
--
-- The indexes created by 20261031130000_add_assignment_unique_constraints assumed
-- that a vehicle or driver could be committed to at most one active trip at a
-- time. That is stricter than the approved universal Vehicle Hire business
-- rules, which allow multiple active commitments whose pickup windows do not
-- overlap (see EnquiryAssignmentService rangesOverlap / pickupWindow). The
-- global indexes therefore rejected legitimate reassignment/parallel
-- scheduling and could not be created on databases that already contained
-- historical duplicate active groups.
--
-- Conflict prevention is still enforced transactionally by
-- TripVehicleAssignmentService + EnquiryAssignmentService (FOR UPDATE locks and
-- overlapping-pickup-window checks). This migration only removes the
-- incompatible database-level shortcut.
--
-- Idempotent: safe on fresh databases (where the indexes exist) and on
-- databases where the earlier migration was resolved as rolled back.
DROP INDEX IF EXISTS "idx_trips_unique_active_vehicle";
DROP INDEX IF EXISTS "idx_trips_unique_active_driver";
