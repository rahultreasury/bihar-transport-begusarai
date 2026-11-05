-- ============================================================================
-- PHASE 9 (B) — TRANSIT WORKSPACE  (split out of phase9_dispatch_workspace)
-- ============================================================================
--
-- NOT part of the Loading → Dispatch deployment.
--
-- Loading → Dispatch stops at DISPATCHED. The incident log and the
-- vehicle-change history belong to the vehicle ON THE ROAD, which is Transit,
-- and they are deployed with the Transit / Delivery / POD / Completion phases.
--
-- STRICTLY ADDITIVE: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Safe to run online with `prisma migrate deploy`, safe to re-run.
--
-- Note: nothing here is referenced by Loading or Dispatch. Loading writes to
-- `trips` and `trip_documents`; Dispatch writes to `trip_dispatches`,
-- `eway_bills` and `trip_insurances`.

-- ── Incidents ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "trip_incidents" (
  "incident_id"         SERIAL PRIMARY KEY,
  "trip_id"             INTEGER NOT NULL,
  "incident_type"       TEXT NOT NULL,
  "description"         TEXT,
  "location"            TEXT,
  "vehicle_can_continue" BOOLEAN,
  "expected_repair_at"  TIMESTAMP(3),
  "photos"              JSONB,
  "resolution"          TEXT NOT NULL DEFAULT 'ONGOING',
  "resolution_remarks"  TEXT,
  "resolved_at"         TIMESTAMP(3),
  "reported_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"          INTEGER,
  "created_at"          TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trip_incidents_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_incident_trip_reported" ON "trip_incidents"("trip_id", "reported_at");
CREATE INDEX IF NOT EXISTS "idx_incident_type" ON "trip_incidents"("incident_type");

-- ── Vehicle change history (the original vehicle is never overwritten) ─────
CREATE TABLE IF NOT EXISTS "trip_vehicle_changes" (
  "change_id"           SERIAL PRIMARY KEY,
  "trip_id"             INTEGER NOT NULL,
  "sequence"            INTEGER NOT NULL DEFAULT 1,

  "old_vehicle_id"      INTEGER,
  "old_vehicle_number"  TEXT,
  "new_vehicle_id"      INTEGER,
  "new_vehicle_number"  TEXT,
  "old_driver_id"       INTEGER,
  "old_driver_name"     TEXT,
  "new_driver_id"       INTEGER,
  "new_driver_name"     TEXT,

  "reason"              TEXT NOT NULL,
  "remarks"             TEXT,
  "location"            TEXT,
  "occurred_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proof_document_id"   INTEGER,
  "incident_id"         INTEGER,

  "created_by"          INTEGER,
  "created_at"          TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trip_vehicle_changes_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE,
  CONSTRAINT "trip_vehicle_changes_proof_document_id_fkey"
    FOREIGN KEY ("proof_document_id") REFERENCES "trip_documents"("document_id") ON DELETE SET NULL,
  CONSTRAINT "trip_vehicle_changes_incident_id_fkey"
    FOREIGN KEY ("incident_id") REFERENCES "trip_incidents"("incident_id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_vehicle_change_trip_seq" ON "trip_vehicle_changes"("trip_id", "sequence");